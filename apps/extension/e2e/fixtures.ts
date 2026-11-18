import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const EXT_DIR = path.resolve(import.meta.dirname, '../.output-e2e/chrome-mv3');
export const FIREFOX_DIR = path.resolve(import.meta.dirname, '../.output-e2e/firefox-mv3');
export const SAMPLE_HAR = path.resolve(import.meta.dirname, '../../../packages/core/test/fixtures/sample.har');

export interface Hit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Local API that records every non-preflight request it receives. */
export async function startServer(routes: Record<string, { type: string; body: string }> = {}) {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      if (req.method !== 'OPTIONS') hits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      // /private/* answers same-origin callers only (no CORS headers), like most first-party APIs
      if (!req.url?.startsWith('/private/')) {
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-headers', '*');
        res.setHeader('access-control-allow-methods', '*');
      }
      const route = routes[req.url ?? ''];
      if (route) {
        res.setHeader('content-type', route.type);
        res.end(route.body);
        return;
      }
      if (req.url === '/') {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><title>test page</title><h1>test page</h1>');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.statusCode = req.method === 'POST' ? 201 : 200;
      res.end(JSON.stringify({ method: req.method, path: req.url, n: hits.length }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A small HAR whose requests point at the local server. */
export function harFor(origin: string): string {
  const entry = (method: string, p: string, body?: string) => ({
    startedDateTime: new Date().toISOString(),
    time: 12,
    request: {
      method,
      url: `${origin}${p}`,
      httpVersion: 'HTTP/1.1',
      headers: [
        { name: 'content-type', value: 'application/json' },
        { name: 'authorization', value: 'Bearer captured-secret' },
        { name: 'cookie', value: 'sid=captured' },
      ],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: body?.length ?? 0,
      ...(body ? { postData: { mimeType: 'application/json', text: body } } : {}),
    },
    response: {
      status: method === 'POST' ? 201 : 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: 'application/json' }],
      cookies: [],
      content: { size: 40, mimeType: 'application/json', text: JSON.stringify({ method, path: p, n: 0 }) },
      redirectURL: '',
      headersSize: -1,
      bodySize: 40,
    },
    cache: {},
    timings: { send: 1, wait: 10, receive: 1 },
  });
  return JSON.stringify({ log: { version: '1.2', entries: [entry('GET', '/api/items'), entry('POST', '/api/items', '{"name":"new"}')] } });
}

export async function importHar(page: Page, name: string, text: string): Promise<void> {
  await page.getByLabel('Import HAR or workspace file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

export const footer = (page: Page) => page.locator('footer');
export const filterBox = (page: Page) => page.getByRole('searchbox', { name: 'Filter requests' });

/** Picks an option of a SelectMenu (the custom select) by the trigger's label. */
export async function choose(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole('option', { name: option }).click();
}

type Fixtures = { context: BrowserContext; extensionId: string; panel: Page };

export const test = base.extend<Fixtures>({
  context: async ({ channel }, use) => {
    const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'bdt-e2e-')), {
      channel,
      // the panel follows the browser language; the suites assert English labels
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--lang=en-US'],
    });
    await use(context);
    await context.close();
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this destructuring
  extensionId: async ({}, use) => {
    const id = process.env.BDT_EXT_ID;
    if (!id) throw new Error('global setup did not compute the extension id');
    await use(id);
  },
  panel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    page.on('dialog', (d) => {
      throw new Error(`unexpected JS dialog: ${d.message()}`);
    });
    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await expect(page.getByRole('tab', { name: 'Network' })).toBeVisible();
    await use(page);
  },
});

export { expect };
