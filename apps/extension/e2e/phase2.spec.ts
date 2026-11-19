import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, filterBox, footer, importHar, startServer, test } from './fixtures.ts';

// ------------------------------------------------------------------------------- fixtures

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'user-42', aud: ['api', 'web'], exp: Math.floor(Date.now() / 1000) + 3600, role: 'admin' })}.c2ln`;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const vlq = (n: number) => {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let d = v & 31;
    v >>>= 5;
    if (v) d |= 32;
    out += B64[d];
  } while (v);
  return out;
};
/** One generated line of absolute segments → VLQ, each field relative to the previous segment. */
const mappings = (segs: number[][]) => {
  const prev = [0, 0, 0, 0, 0];
  return segs
    .map((seg) =>
      seg
        .map((x, i) => {
          const d = x - (prev[i] ?? 0);
          prev[i] = x;
          return vlq(d);
        })
        .join(''),
    )
    .join(',');
};
const ORIGINAL = 'export function add(a: number, b: number): number {\n  return a + b;\n}\nconsole.log(add(1, 2));\n';
const GENERATED = 'function add(a,b){return a+b}console.log(add(1,2));';
const MAP = {
  version: 3,
  sources: ['src/add.ts'],
  sourcesContent: [ORIGINAL],
  names: ['add'],
  mappings: mappings([
    [0, 0, 0, 0],
    [9, 0, 0, 16, 0],
    [18, 0, 1, 2],
  ]),
};
const INLINE_JS = `${GENERATED}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(MAP)).toString('base64')}`;
const MINIFIED = `!function(){${Array.from({ length: 40 }, (_, i) => `var v${i}=function(x){if(x>${i}){return"s${i};"}else{return x*${i}}};`).join('')}}();`;

function har(origin: string): string {
  const entry = (
    path: string,
    mime: string,
    text: string,
    o: { encoding?: string; reqHeaders?: { name: string; value: string }[]; resHeaders?: { name: string; value: string }[] } = {},
  ) => ({
    startedDateTime: new Date().toISOString(),
    time: 9,
    request: {
      method: 'GET',
      url: `${origin}${path}`,
      httpVersion: 'HTTP/1.1',
      headers: o.reqHeaders ?? [],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: mime }, ...(o.resHeaders ?? [])],
      cookies: [],
      content: { size: text.length, mimeType: mime, text, ...(o.encoding ? { encoding: o.encoding } : {}) },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 1, wait: 5, receive: 3 },
  });
  return JSON.stringify({
    log: {
      entries: [
        entry('/api/user', 'application/json', '{"id":42,"name":"Ada"}', {
          reqHeaders: [
            { name: 'authorization', value: `Bearer ${JWT}` },
            { name: 'cookie', value: 'sid=captured; theme=dark' },
          ],
          resHeaders: [{ name: 'set-cookie', value: 'sid=new; Path=/; HttpOnly; SameSite=Lax; Max-Age=60' }],
        }),
        entry('/static/app.min.js', 'application/javascript', INLINE_JS),
        entry('/static/ext.min.js', 'application/javascript', `${GENERATED}\n//# sourceMappingURL=ext.min.js.map`),
        entry('/static/bundle.js', 'application/javascript', MINIFIED),
        entry(
          '/img/pixel.png',
          'image/png',
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          { encoding: 'base64' },
        ),
        entry('/bin/doc.bin', 'application/octet-stream', Buffer.from('%PDF-1.7 binary').toString('base64'), { encoding: 'base64' }),
      ],
    },
  });
}

async function open(panel: Page, path: string) {
  await filterBox(panel).fill('');
  await panel
    .getByRole('row', { name: new RegExp(path.replaceAll('.', '\\.')) })
    .first()
    .click();
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Records what the clipboard fallback copies (execCommand fires a copy event on the selected textarea). */
const recordCopies = (panel: Page) =>
  panel.evaluate(() => {
    (window as unknown as { copied: string[] }).copied = [];
    document.addEventListener('copy', (e) => {
      if (e.target instanceof HTMLTextAreaElement) (window as unknown as { copied: string[] }).copied.push(e.target.value);
    });
  });
const copies = (panel: Page) => panel.evaluate(() => (window as unknown as { copied: string[] }).copied);

/** Cookie names in the browser's real jar for a URL (the E2E build holds the cookies permission). */
const jarNames = (panel: Page, url: string) =>
  panel.evaluate(async (u) => {
    const api = (globalThis as unknown as { chrome: { cookies: { getAll(d: { url: string }): Promise<{ name: string }[]> } } }).chrome;
    return (await api.cookies.getAll({ url: u })).map((c) => c.name);
  }, url);

// ---------------------------------------------------------------------------------- tests

test('badges, copy buttons (success, failure, no layout shift) and secrets in copies', async ({ panel }) => {
  const server = await startServer();
  try {
    await importHar(panel, 'p2.har', har(server.url));
    await expect(footer(panel)).toContainText('6 / 6 requests');
    const row = panel.getByRole('row', { name: /\/api\/user/ });
    await expect(row.getByText('GET', { exact: true })).toHaveAttribute('style', /--color-m-get/);
    await expect(row.getByText('200', { exact: true })).toHaveAttribute('style', /--color-s-2xx/);
    await row.click();
    await recordCopies(panel);

    const copyUrl = panel.getByRole('button', { name: 'Copy request URL' });
    const before = await copyUrl.boundingBox();
    const header = await panel.getByRole('article', { name: 'Request details' }).boundingBox();
    await copyUrl.click();
    await expect(copyUrl).toHaveAttribute('data-copy-state', 'copied');
    await expect(panel.getByRole('status').filter({ hasText: 'Copied' }).first()).toBeVisible();
    expect(await copyUrl.boundingBox()).toEqual(before);
    expect(await panel.getByRole('article', { name: 'Request details' }).boundingBox()).toEqual(header);
    await panel.getByRole('button', { name: /^Copy as cURL/ }).click();
    await panel.getByRole('button', { name: 'Copy Request headers' }).click();
    const [url, curl, headers] = await copies(panel);
    expect(url).toBe(`${server.url}/api/user`);
    expect(curl).toMatch(/^curl /);
    expect(curl).not.toContain(JWT); // credentials omitted from cURL
    expect(headers).toContain('authorization: [REDACTED]');
    await expect(copyUrl).toHaveAttribute('data-copy-state', 'idle', { timeout: 3000 });

    // a refused clipboard is reported, never shown as success
    await panel.evaluate(() => {
      document.execCommand = () => false;
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await copyUrl.click();
    await expect(copyUrl).toHaveAttribute('data-copy-state', 'failed');
    await expect(panel.getByText('Copy failed').first()).toBeVisible();
  } finally {
    await server.close();
  }
});

test('auth section decodes the JWT locally and keeps it hidden by default', async ({ panel }) => {
  await importHar(panel, 'p2.har', har('http://127.0.0.1:1'));
  await open(panel, '/api/user');
  const auth = panel.getByRole('region', { name: 'Authentication' });
  await expect(auth).toContainText('Bearer · JWT');
  await expect(auth).not.toContainText(JWT);
  await panel.getByText('Decoded token from authorization').click();
  await expect(panel.getByText('does not verify its signature or cryptographic validity')).toBeVisible();
  const claims = panel.getByRole('region', { name: 'Claims' });
  await expect(claims).toContainText('user-42');
  await expect(claims).toContainText('api, web');
  await expect(claims).toContainText('admin');
  await expect(panel.getByRole('button', { name: 'Copy full token' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Show secrets' }).click();
  await expect(auth).toContainText(JWT);
  await expect(panel.getByRole('button', { name: 'Copy full token' })).toBeEnabled();
  // revealing is temporary: another request hides secrets again
  await open(panel, '/img/pixel.png');
  await open(panel, '/api/user');
  await expect(panel.getByRole('region', { name: 'Authentication' })).not.toContainText(JWT);
  // the General, Authentication, Response and Request tables share one name-column width
  const widths = await panel
    .getByRole('article', { name: 'Request details' })
    .locator('dl > div > dt')
    .evaluateAll((dts) => [...new Set(dts.map((d) => Math.round(d.getBoundingClientRect().width)))]);
  expect(widths).toHaveLength(1);
});

test('viewers: JSON and JS formatted with highlighting, hex never by default, previews sandboxed', async ({ panel }) => {
  await importHar(panel, 'p2.har', har('http://127.0.0.1:1'));
  await open(panel, '/api/user');
  await panel.getByRole('tab', { name: 'Response' }).click();
  const radios = panel.getByRole('radiogroup', { name: 'Response body view' }).getByRole('radio');
  await expect(radios).toHaveText(['Pretty', 'Tree', 'Raw']);
  await expect(panel.getByText('JSON · object · 2 keys')).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Response body (Pretty)' }).locator('[data-token="prop"]').first()).toHaveText('"id"');

  await open(panel, '/static/bundle.js');
  await expect(panel.getByText(/JavaScript · minified, formatted only/)).toBeVisible();
  await expect(panel.getByTestId('sourcemap-status')).toHaveText('Not declared');
  const pretty = panel.getByRole('region', { name: 'Response body (Pretty)' });
  await expect(pretty.locator('[data-line]')).not.toHaveCount(1);
  await expect(pretty.locator('[data-token="kw"]').first()).toHaveText('function');

  await open(panel, '/img/pixel.png');
  await expect(panel.getByRole('radio', { name: 'Preview' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('img', { name: 'Response body preview' })).toBeVisible();

  await open(panel, '/bin/doc.bin');
  await expect(panel.getByText('Binary content, shown as base64')).toBeVisible();
  await expect(panel.getByText('Hex dump', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Response body options' }).click();
  await panel.getByRole('menuitem', { name: 'Show hex dump' }).click();
  await expect(panel.getByRole('region', { name: 'Response body (Hex)' })).toContainText('25 50 44 46');
  await open(panel, '/api/user'); // another body: back to the default view
  await expect(panel.getByRole('region', { name: 'Response body (Pretty)' })).toBeVisible();
});

test('source maps: embedded and external, with original positions, never invented', async ({ panel }) => {
  const server = await startServer({ '/static/ext.min.js.map': { type: 'application/json', body: JSON.stringify(MAP) } });
  try {
    await importHar(panel, 'p2.har', har(server.url));
    await open(panel, '/static/app.min.js');
    await panel.getByRole('tab', { name: 'Response' }).click();
    await expect(panel.getByTestId('sourcemap-status')).toHaveText('Embedded');
    await expect(panel.getByRole('region', { name: 'Original source src/add.ts' })).toContainText('return a + b;');
    // place the caret on "return" (column 20) in the Raw view and press Enter
    await panel.getByRole('radio', { name: 'Raw' }).click();
    const raw = panel.getByRole('region', { name: 'Response body (Raw)' });
    await raw.evaluate((el) => {
      const text = el.querySelector('[data-line="0"] [data-code] span')!.firstChild!;
      getSelection()!.setBaseAndExtent(text, 20, text, 20);
    });
    await raw.focus();
    await panel.keyboard.press('Enter');
    await expect(panel.getByText('Generated 1:21 → src/add.ts:2:3')).toBeVisible();

    await open(panel, '/static/ext.min.js');
    await expect(panel.getByTestId('sourcemap-status')).toHaveText('External found');
    expect(server.hits.some((h) => h.url.endsWith('.map'))).toBe(false); // nothing is fetched without the explicit action
    await panel.getByRole('button', { name: 'Load source map', exact: true }).click();
    await expect(panel.getByTestId('sourcemap-status')).toHaveText('External found · loaded');
    await expect(panel.getByRole('region', { name: `Original source ${server.url}/static/src/add.ts` })).toContainText(
      'export function add',
    );
  } finally {
    await server.close();
  }
});

test('cookies: table, redacted export, edited replay copy and the real jar with undo', async ({ panel }) => {
  const server = await startServer();
  try {
    await importHar(panel, 'p2.har', har(server.url));
    await open(panel, '/api/user');
    await panel.getByRole('tab', { name: /^Cookies/ }).click();
    const response = panel.getByRole('region', { name: 'Response cookies (Set-Cookie)', exact: true });
    await expect(response).toContainText('HttpOnly SameSite=Lax');
    await expect(response).toContainText('Max-Age=60');
    await expect(panel.getByRole('note')).toContainText('2 of 3 cookies look like credentials');

    const [redacted] = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Export cookies', exact: true }).click(),
    ]);
    const json = readFileSync(await redacted.path(), 'utf8');
    expect(json).toContain('[REDACTED]');
    expect(json).not.toContain('captured');
    await panel.getByRole('button', { name: /^Cookie export format:/ }).click();
    await panel.getByRole('option', { name: /Netscape cookie jar/ }).click();
    await panel.getByRole('button', { name: 'Export cookies', exact: true }).click();
    await expect(panel.getByRole('dialog', { name: 'Export cookies?' })).toBeVisible();
    await panel.keyboard.press('Escape');

    // edit a copy for replay: the server gets it, the browser jar and the capture do not change
    await panel.getByRole('button', { name: 'Edit copy for replay' }).click();
    await panel.getByLabel('Value of sid').fill('edited');
    await panel.getByLabel('Send these cookies with the replay').check();
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(panel.getByRole('dialog', { name: 'Send GET request?' })).toContainText('2 edited cookies');
    await panel.getByRole('button', { name: 'Send GET' }).click();
    await expect.poll(() => server.hits.length).toBe(1);
    expect(server.hits[0]!.headers.cookie).toBe('sid=edited; theme=dark');
    expect(server.hits[0]!.headers.authorization).toBeUndefined();
    expect(await jarNames(panel, server.url)).toEqual([]);

    // real jar: create with confirmation, then undo
    await panel.getByRole('tab', { name: 'Network' }).click();
    await panel.getByRole('tab', { name: /^Cookies/ }).click();
    await panel.getByRole('button', { name: 'Manage browser cookies' }).click();
    await panel.getByRole('button', { name: 'Add', exact: true }).click();
    const jar = panel.getByRole('region', { name: /^Browser cookies for/ }).last();
    await jar.getByLabel('Cookie name').last().fill('bdt_test');
    await jar.getByLabel('Value of bdt_test').fill('v1');
    await jar.getByRole('button', { name: 'Apply bdt_test' }).click();
    const confirm = panel.getByRole('dialog', { name: 'Create cookie bdt_test?' });
    await expect(confirm).toContainText('Host-only cookie for 127.0.0.1');
    await confirm.getByRole('button', { name: 'Apply change' }).click();
    await expect.poll(() => jarNames(panel, server.url)).toEqual(['bdt_test']);
    await panel.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => jarNames(panel, server.url)).toEqual([]);
  } finally {
    await server.close();
  }
});

test('custom selects by keyboard, no visible native select, accessible dialogs', async ({ panel }) => {
  await importHar(panel, 'p2.har', har('http://127.0.0.1:1'));
  for (const view of ['Network', 'Replay', 'Collections']) {
    await panel.getByRole('tab', { name: view }).click();
    await expect(panel.locator('select:visible')).toHaveCount(0);
  }
  await panel.getByRole('button', { name: 'New', exact: true }).last().click(); // second environment
  const trigger = panel.getByRole('button', { name: /^Active environment:/ });
  await expect(trigger).toHaveAccessibleName('Active environment: New environment');
  await trigger.focus();
  await panel.keyboard.press('ArrowDown');
  const list = panel.getByRole('listbox', { name: 'Active environment' });
  await expect(list).toBeVisible();
  await expect(list).toBeFocused();
  await panel.keyboard.press('Home');
  await panel.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName('Active environment: Default');
  await panel.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();
  await panel.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(trigger).toBeFocused();

  // workspace and environment changes reach Replay
  await panel.getByRole('tab', { name: 'Replay' }).click();
  await expect(panel.getByRole('button', { name: /^Environment:/ })).toHaveAccessibleName('Environment: Default');
  await axe(panel, 'replay');

  await panel.getByRole('tab', { name: 'Network' }).click();
  await panel.keyboard.press('Control+Shift+E');
  await expect(panel.getByRole('dialog', { name: 'Export requests' })).toBeVisible();
  await axe(panel, 'export dialog');
  await panel.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Settings' }).click();
  await expect(panel.getByRole('button', { name: /^Theme:/ })).toBeVisible();
  await axe(panel, 'settings dialog');
});
