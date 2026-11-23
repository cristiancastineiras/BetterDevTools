// Helpers for the specs that drive a real DevTools window over raw CDP: DevTools targets are
// invisible to Playwright, so the frontend and the extension panel are reached through their debugger sockets.
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXT_DIR } from './fixtures.ts';

interface Reply {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
}

export interface Target {
  url: string;
  webSocketDebuggerUrl: string;
}

export async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 15_000): Promise<T> {
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

export async function cdp(wsUrl: string) {
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

/** Opens `url` in a Chromium with real DevTools docked, shows the BetterDevTools panel and returns its CDP handle. */
export async function openRealDevtools(channel: string | undefined, url: string) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bdt-real-')), {
    channel,
    locale: 'en-US',
    args: [
      '--lang=en-US',
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--auto-open-devtools-for-tabs',
      `--remote-debugging-port=${port}`,
    ],
  });
  const targets = async (): Promise<Target[]> => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const find = async (match: (t: Target) => boolean, what: string) =>
    (await until(async () => (await targets()).find(match), Boolean, what))!;
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  const front = await cdp((await find((t) => t.url.startsWith('devtools://'), 'DevTools frontend')).webSocketDebuggerUrl);
  await until(
    () => front.eval('document.readyState'),
    (s) => s === 'complete',
    'DevTools frontend to load',
  );
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
  return { context, page, front, panel };
}
