/* oxlint-disable unicorn/require-post-message-target-origin -- BroadcastChannel and Worker take no targetOrigin */
// The Realtime view in real DevTools: the hook runs in a real page and the panel lists what it sees.
// WebTransport has no server here, so it covers the failure path; the rest is the real thing.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, startServer, test } from './fixtures.ts';
import { openRealDevtools, until } from './real-devtools.ts';

// axe-core comes with @axe-core/playwright; the panel is a DevTools target, so it is injected over CDP
const requireFromHere = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(createRequire(requireFromHere.resolve('@axe-core/playwright')).resolve('axe-core/axe.min.js'), 'utf8');

const SERVER_ROUTES = {
  '/worker.js': { type: 'application/javascript', body: "self.onmessage = (e) => self.postMessage('echo:' + e.data);" },
  '/sw.js': {
    type: 'application/javascript',
    body: "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));",
  },
  // opens a channel while it loads: only a hook that runs before the page's scripts can see it
  '/early.html': { type: 'text/html', body: "<!doctype html><title>early</title><script>new BroadcastChannel('during-load')</script>" },
};

test('lists WebRTC, BroadcastChannel, workers, Service Workers and WebTransport from a real page', async ({ channel }) => {
  const server = await startServer(SERVER_ROUTES);
  const { context, page, front, panel } = await openRealDevtools(channel, server.url);
  try {
    const click = (selector: string, text: string) =>
      panel.eval(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})?.click()`,
      );
    const rows = () => panel.eval(`[...document.querySelectorAll('table tbody tr')].map((r) => r.textContent)`) as Promise<string[]>;
    const detail = () => panel.eval(`document.querySelector('[aria-label="Session details"]')?.textContent ?? ''`) as Promise<string>;

    await click('[role=tab]', 'Realtime');
    await until(
      () => page.evaluate(() => Boolean((globalThis as Record<string, unknown>).__betterDevToolsRealtime)),
      Boolean,
      'the hook in the inspected page',
    );

    const outcome = await page.evaluate(async () => {
      // BroadcastChannel: one sender, one receiver
      const a = new BroadcastChannel('e2e-chat');
      const b = new BroadcastChannel('e2e-chat');
      const heard = new Promise((resolve) => (b.onmessage = (event) => resolve(event.data)));
      a.postMessage({ hello: 'world' });

      // dedicated worker that echoes
      const worker = new Worker('/worker.js');
      const echoed = new Promise((resolve) => (worker.onmessage = (event) => resolve(event.data)));
      worker.postMessage('ping');

      // two peers in this page, one data channel: signalling is the part the panel must show
      const left = new RTCPeerConnection();
      const right = new RTCPeerConnection();
      left.onicecandidate = (event) => event.candidate && void right.addIceCandidate(event.candidate);
      right.onicecandidate = (event) => event.candidate && void left.addIceCandidate(event.candidate);
      const dataChannel = left.createDataChannel('e2e-data');
      const opened = new Promise((resolve) => (dataChannel.onopen = () => resolve(true)));
      await left.setLocalDescription(await left.createOffer());
      await right.setRemoteDescription(left.localDescription!);
      await right.setLocalDescription(await right.createAnswer());
      await left.setRemoteDescription(right.localDescription!);
      const connected = await Promise.race([opened, new Promise((resolve) => setTimeout(() => resolve(false), 8000))]);
      if (connected) dataChannel.send('over the data channel');

      // Service Worker lifecycle
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // WebTransport to a port nobody listens on: the session exists and fails
      const transport = new WebTransport('https://127.0.0.1:9/');
      await transport.ready.catch(() => undefined);
      await transport.closed.catch(() => undefined);

      return { heard: await heard, echoed: await echoed, connected };
    });
    expect(outcome.heard).toEqual({ hello: 'world' }); // the hook left the page's own channels working
    expect(outcome.echoed).toBe('echo:ping');

    const seen = await until(
      rows,
      (all) =>
        ['BroadcastChannel', 'Worker', 'WebRTC', 'Service Worker', 'WebTransport'].every((kind) => all.some((text) => text.includes(kind))),
      'a row for every kind',
    );
    expect(seen.some((text) => text.includes('e2e-chat'))).toBe(true);
    expect(seen.some((text) => text.includes('/worker.js'))).toBe(true);
    expect(seen.some((text) => text.includes('/sw.js') && text.includes('activated'))).toBe(true);
    expect(seen.some((text) => text.includes('https://127.0.0.1:9/'))).toBe(true);

    // a session opens into its timeline, with the payload as the page sent it
    await panel.eval(`[...document.querySelectorAll('table tbody tr')].find((r) => r.textContent.includes('e2e-chat')).click()`);
    const timeline = await until(detail, (text) => text.includes('world'), 'the BroadcastChannel timeline');
    expect(timeline).toContain('"hello": "world"');

    await panel.eval(`[...document.querySelectorAll('table tbody tr')].find((r) => r.textContent.includes('WebRTC')).click()`);
    const rtc = await until(detail, (text) => text.includes('createOffer'), 'the WebRTC timeline');
    expect(rtc).toContain('v=0'); // the SDP
    expect(rtc).toContain('e2e-data'); // the data channel

    // the populated view, with a session open, has no serious accessibility violations
    await panel.eval(AXE_SOURCE);
    const violations = (await panel.eval(
      `axe.run(document).then((r) => r.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')))`,
    )) as string[];
    expect(violations).toEqual([]);

    // the filter narrows the list by kind and by payload
    await panel.eval(
      `(() => { const i = document.querySelector('[aria-label="Filter realtime sessions"]'); i.value = 'kind:worker'; i.dispatchEvent(new InputEvent('input', { bubbles: true })); })()`,
    );
    const filtered = await until(
      rows,
      (all) => all.length > 0 && all.every((text) => text.includes('Worker') && !text.includes('Service')),
      'worker rows only',
    );
    expect(filtered.every((text) => !text.includes('WebRTC'))).toBe(true);
  } finally {
    front.close();
    panel.close();
    await context.close();
    await server.close();
  }
});

test('"Reload" installs the hook before the page scripts, so channels opened while loading show up', async ({ channel }) => {
  const server = await startServer(SERVER_ROUTES);
  const { context, page, front, panel } = await openRealDevtools(channel, `${server.url}/early.html`);
  try {
    const rows = () => panel.eval(`[...document.querySelectorAll('table tbody tr')].map((r) => r.textContent)`) as Promise<string[]>;
    await panel.eval(`[...document.querySelectorAll('[role=tab]')].find((e) => e.textContent.trim() === 'Realtime').click()`);
    await until(
      () => page.evaluate(() => Boolean((globalThis as Record<string, unknown>).__betterDevToolsRealtime)),
      Boolean,
      'the hook in the inspected page',
    );
    // opened before the hook existed: not listed
    expect((await rows()).some((text) => text.includes('during-load'))).toBe(false);

    await panel.eval(`document.querySelector('button[title^="Reload the page with the hook"]').click()`);
    await until(rows, (all) => all.some((text) => text.includes('during-load')), 'the channel the page opened while loading');
  } finally {
    front.close();
    panel.close();
    await context.close();
    await server.close();
  }
});
