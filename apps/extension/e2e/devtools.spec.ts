// Smoke test inside real DevTools (no API stubs): the page's traffic must reach the panel with bodies,
// and survive a navigation. DevTools targets are invisible to Playwright, so they are driven over raw CDP.
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXT_DIR, expect, startServer, test } from './fixtures.ts';

interface Reply {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
}

interface Target {
  url: string;
  webSocketDebuggerUrl: string;
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < end) {
    try {
      last = await read();
      if (ok(last)) return last;
    } catch {
      // target not ready yet: retry until the deadline
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
}

async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const waiting = new Map<number, (msg: Reply) => void>();
  ws.onmessage = (m) => {
    const msg: Reply = JSON.parse(String(m.data));
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  };
  return {
    async eval(expression: string): Promise<unknown> {
      const id = ++seq;
      const msg = await new Promise<Reply>((resolve) => {
        waiting.set(id, resolve);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (msg.result?.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails));
      return msg.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

test('captures live traffic with bodies in real DevTools and keeps it across navigation', async ({ channel }) => {
  const server = await startServer();
  const port = 9300 + Math.floor(Math.random() * 600);
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bdt-real-')), {
    channel,
    locale: 'en-US',
    args: [
      '--lang=en-US', // DevTools panels are not emulated: the panel follows the browser's own language
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--auto-open-devtools-for-tabs',
      `--remote-debugging-port=${port}`,
    ],
  });
  const targets = async (): Promise<Target[]> => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const find = async (match: (t: Target) => boolean, what: string) =>
    (await until(async () => (await targets()).find(match), Boolean, what))!;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url);
    const front = await cdp((await find((t) => t.url.startsWith('devtools://'), 'DevTools frontend')).webSocketDebuggerUrl);
    await until(
      () => front.eval('document.readyState'),
      (s) => s === 'complete',
      'DevTools frontend to load',
    );
    // traffic before the panel is first shown: reachable only through getHAR() backfill
    // DevTools enables network recording asynchronously after its document loads; no event exposes it
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => fetch('/api/early').then((r) => r.text()));

    await until(
      () =>
        // the extension registers its panel asynchronously; showing an unknown id is a silent no-op
        front.eval(`(async () => {
          const UI = await import('./ui/legacy/legacy.js');
          const view = UI.InspectorView.InspectorView.instance();
          const id = 'chrome-extension://${process.env.BDT_EXT_ID}BetterDevTools';
          if (!view.tabbedPane.tabIds().includes(id)) return false;
          await view.showPanel(id);
          return true;
        })()`),
      (v) => v === true,
      'BetterDevTools panel to open',
    );
    const panel = await cdp((await find((t) => t.url.endsWith('/panel.html'), 'panel document')).webSocketDebuggerUrl);
    const rows = () =>
      panel.eval(`[...document.querySelectorAll('[role=row][id^=request-row-]')].map((r) => r.textContent)`) as Promise<string[]>;
    await until(rows, (r) => r.some((t) => t.includes('/api/early')), 'backfilled request');

    await page.evaluate(() =>
      Promise.all([
        fetch('/api/one').then((r) => r.text()),
        fetch('/api/two', { method: 'POST', body: '{"a":1}' }).then((r) => r.text()),
        fetch('/private/me').then((r) => r.text()),
      ]),
    );
    const seen = await until(
      rows,
      (r) => ['/api/early', '/api/one', '/api/two'].every((p) => r.some((t) => t.includes(p))),
      'captured rows',
    );
    expect(seen.filter((t) => t.includes('/api/one'))).toHaveLength(1); // no duplicates from in-flight backfill

    // navigation resets DevTools' request ids; bodies were read at capture time so they must still be there
    await page.goto(`${server.url}/?next`);
    await until(rows, (r) => r.some((t) => t.includes('/?next')), 'row after navigation');
    await panel.eval(
      `[...document.querySelectorAll('[role=row][id^=request-row-]')].find((r) => r.textContent.includes('/api/two')).click()`,
    );
    await panel.eval(`[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Response').click()`);
    const body = await until(
      () => panel.eval(`document.querySelector('[aria-label="Response body (Pretty)"]')?.textContent ?? ''`) as Promise<string>,
      (t) => t.includes('/api/two'),
      'response body of /api/two',
    );
    expect(body).toContain('"method": "POST"');
    expect(String(await panel.eval(`document.querySelector('footer').textContent`))).not.toContain('not attached');

    // an untouched replay of a same-origin API without CORS headers works: it is sent from the inspected page
    const privateHits = () => server.hits.filter((hit) => hit.url === '/private/me').length;
    const hitsBefore = privateHits();
    await panel.eval(
      `[...document.querySelectorAll('[role=row][id^=request-row-]')].find((r) => r.textContent.includes('/private/me')).click()`,
    );
    await panel.eval(`document.querySelector('button[title="Replay this request (R)"]').click()`);
    await panel.eval(`document.querySelector('button[title="Send (Ctrl+Enter)"]').click()`);
    const result = await until(
      () => panel.eval(`document.querySelector('[aria-label="Replay result"]')?.textContent ?? ''`) as Promise<string>,
      (text) => text.includes('200') || text.includes('failed'),
      'replay result',
    );
    expect(result).toContain('200');
    expect(result).not.toContain('failed');
    expect(privateHits()).toBe(hitsBefore + 1);
    front.close();
    panel.close();
  } finally {
    await context.close();
    await server.close();
  }
});
