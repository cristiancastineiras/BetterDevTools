import { AxeBuilder } from '@axe-core/playwright';
import { decodeToon } from '@betterdevtools/core';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { choose, expect, filterBox, footer, harFor, importHar, SAMPLE_HAR, startServer, test } from './fixtures.ts';

const sample = readFileSync(SAMPLE_HAR, 'utf8');

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('imports a HAR, filters, inspects safely and passes axe in both themes and a narrow panel', async ({ panel }) => {
  await expect(footer(panel)).toContainText('not attached to DevTools');
  await importHar(panel, 'sample.har', sample);
  await expect(footer(panel)).toContainText('6 / 6 requests');
  await expect(panel.getByRole('status')).toContainText('skipped 1 invalid');

  await filterBox(panel).fill('method:post');
  await expect(footer(panel)).toContainText('2 / 6 requests');
  await panel.getByRole('row', { name: /graphql/ }).click();
  await panel.getByRole('tab', { name: 'Payload' }).click();
  await expect(panel.getByRole('region', { name: 'Request body (Pretty)' })).toContainText('query Me {');
  await expect(panel.getByRole('region', { name: 'Request body', exact: true })).toContainText('GraphQL');

  await filterBox(panel).fill('status:5xx');
  await panel.getByRole('row', { name: /users\/42/ }).click();
  await panel.getByRole('tab', { name: 'Response' }).click();
  await panel.getByRole('radio', { name: 'Preview' }).click();
  const frame = panel.locator('iframe[title^="Response body rendered"]');
  await expect(frame).toHaveAttribute('sandbox', '');
  await expect(frame.contentFrame().getByRole('heading', { name: 'Oops' })).toBeVisible(); // rendered, script blocked (dialog handler would throw)

  await filterBox(panel).fill('');
  await panel.getByRole('row', { name: /users\/42\?expand/ }).click();
  await panel.getByRole('tab', { name: 'Headers' }).click();
  await expect(panel.getByText('Bearer live-secret')).toHaveCount(0); // secrets masked in the UI by default
  await panel.getByRole('tab', { name: 'Response' }).click();
  await expect(panel.getByRole('region', { name: 'Response body (Pretty)' })).toContainText('12345678901234567890');

  await axe(panel, 'light');
  await panel.emulateMedia({ colorScheme: 'dark' });
  await axe(panel, 'dark');
  await panel.setViewportSize({ width: 600, height: 700 });
  await axe(panel, 'narrow');
});

test('keyboard: grid selection, context menu, command palette', async ({ panel }) => {
  await importHar(panel, 'sample.har', sample);
  const grid = panel.getByRole('grid', { name: 'Captured requests' });
  await grid.focus();
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('Shift+ArrowDown');
  await expect(footer(panel)).toContainText('2 selected');
  await panel.keyboard.press('Control+a');
  await expect(footer(panel)).toContainText('6 selected');

  await panel.keyboard.press('Shift+F10');
  const menu = panel.getByRole('menu', { name: 'Request actions' });
  await expect(menu).toBeVisible();
  await expect(panel.getByRole('menuitem', { name: 'Copy 6 URLs' })).toBeFocused();
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(grid).toBeFocused();
  await expect(footer(panel)).toContainText('6 selected'); // menu keys never reached the grid

  await panel.keyboard.press('Control+k');
  await panel.getByRole('combobox', { name: 'Command' }).fill('theme: dark');
  await panel.keyboard.press('Enter');
  await expect(panel.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
  await panel.keyboard.press('Control+k');
  await panel.getByRole('combobox', { name: 'Command' }).fill('settings');
  await panel.keyboard.press('Enter');
  await expect(panel.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('replay: POST waits for confirmation, credentials stay out, results compare with the capture', async ({ panel }) => {
  const server = await startServer();
  try {
    await importHar(panel, 'local.har', harFor(server.url));
    await panel.getByRole('row', { name: /POST/ }).click();
    await panel.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(panel.getByRole('button', { name: /^Method:/ })).toHaveAccessibleName('Method: POST');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    const confirm = panel.getByRole('dialog', { name: 'Send POST request?' });
    await expect(confirm).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await panel.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    expect(server.hits).toHaveLength(0);

    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await panel.getByRole('button', { name: 'Send POST' }).click();
    await expect(panel.getByText('replay response')).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Replay result' })).toContainText('201');
    expect(server.hits).toHaveLength(1);
    expect(server.hits[0]).toMatchObject({ method: 'POST', url: '/api/items', body: '{"name":"new"}' });
    expect(server.hits[0]!.headers.authorization).toBeUndefined();
    expect(server.hits[0]!.headers.cookie).toBeUndefined();

    await panel.getByRole('tab', { name: 'Compare with capture' }).click();
    await expect(panel.getByText('captured 201 → replay 201')).toBeVisible();
    await expect(panel.getByText(/1 removed, 1 added/).first()).toBeVisible();
    await expect(panel.getByRole('complementary', { name: 'Replay history' })).toContainText('POST');

    // a safe method goes out without the dialog
    await choose(panel, 'Method', 'GET');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => server.hits.length).toBe(2);
    await axe(panel, 'replay');
  } finally {
    await server.close();
  }
});

test('workspaces survive a reload and a corrupt import changes nothing', async ({ panel }) => {
  await importHar(panel, 'sample.har', sample);
  await panel.getByRole('row', { name: /graphql/ }).click();
  await panel.getByRole('button', { name: 'Save to collection' }).click();
  const save = panel.getByRole('dialog', { name: 'Save to collection' });
  await save.getByLabel('Name').fill('GraphQL me');
  await save.getByRole('button', { name: 'Save' }).click();
  await panel.getByRole('tab', { name: 'Collections' }).click();
  await expect(panel.getByRole('button', { name: 'POST GraphQL me' })).toBeVisible();

  await panel.reload();
  await panel.getByRole('tab', { name: 'Collections' }).click();
  await expect(panel.getByRole('button', { name: 'POST GraphQL me' })).toBeVisible();

  await importHar(
    panel,
    'broken.json',
    '{"format":"betterdevtools.workspace","workspace":{"schemaVersion":1,"id":"x","collections":"nope"}}',
  );
  await expect(panel.getByRole('alert')).toContainText('Import of broken.json failed');
  await panel.reload();
  await panel.getByRole('tab', { name: 'Collections' }).click();
  await expect(panel.getByRole('button', { name: 'POST GraphQL me' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Workspace:/ })).not.toContainText('imported');
  await axe(panel, 'collections');
});

test('bulk export writes every format, redacted by default', async ({ panel }) => {
  await importHar(panel, 'sample.har', sample);
  await panel.getByRole('grid').focus();
  await panel.keyboard.press('Control+a');

  const exportAs = async (label: string) => {
    await panel.keyboard.press('Control+Shift+E');
    const dialog = panel.getByRole('dialog', { name: 'Export requests' });
    await dialog.getByRole('button', { name: /^Format:/ }).click();
    await panel.getByRole('option', { name: label }).click();
    const [download] = await Promise.all([panel.waitForEvent('download'), dialog.getByRole('button', { name: /^Export \d+/ }).click()]);
    return readFileSync(await download.path(), 'utf8');
  };

  const ndjson = (await exportAs('NDJSON')).trimEnd().split('\n');
  expect(ndjson).toHaveLength(6);
  expect(ndjson[0]).toContain('[REDACTED]');
  expect(ndjson[0]).not.toContain('live-secret');
  const har = JSON.parse(await exportAs('HAR 1.2'));
  expect(har.log.entries).toHaveLength(6);
  expect((await exportAs('CSV (metadata)')).trimEnd().split('\r\n')).toHaveLength(7);
  const toon = decodeToon(await exportAs('TOON v1'));
  expect(toon).toMatchObject({ format: 'betterdevtools.export', count: 6 });
});

test('gate: 50,000 requests import, filter and scroll without freezing', async ({ panel }, info) => {
  const entries = Array.from({ length: 50_000 }, (_, i) => ({
    startedDateTime: new Date(1_767_225_600_000 + i).toISOString(),
    time: i % 900,
    request: { method: i % 4 ? 'GET' : 'POST', url: `https://api${i % 13}.example.com/items/${i}?q=${i % 97}`, headers: [] },
    response: {
      status: [200, 201, 404, 500][i % 4],
      content: { size: 100 + (i % 3000), mimeType: 'application/json', text: `{"id":${i}}` },
    },
  }));
  const startupMs = await panel.evaluate(() => Math.round(performance.getEntriesByType('navigation')[0]?.duration ?? -1));
  // the ring buffer keeps 10,000 by default; raise it like a user would
  await panel.getByRole('button', { name: 'Settings' }).click();
  await panel.getByRole('button', { name: 'Capture', exact: true }).click();
  await panel.getByLabel('Keep at most').fill('50000');
  await panel.getByRole('button', { name: 'Apply limits' }).click();
  await panel.keyboard.press('Escape');
  const t0 = Date.now();
  await importHar(panel, 'big.har', JSON.stringify({ log: { entries } }));
  await expect(footer(panel)).toContainText('50,000 / 50,000 requests', { timeout: 60_000 });
  const importMs = Date.now() - t0;

  // the page must keep painting frames while we filter
  const t1 = Date.now();
  await filterBox(panel).fill('status:404 method:get');
  await expect(footer(panel)).toContainText('12,500 / 50,000 requests');
  const filterRoundTripMs = Date.now() - t1;
  const filterMs = Number((await footer(panel).textContent())?.match(/filter ([\d.]+) ms/)?.[1]);

  const grid = panel.getByRole('grid');
  await grid.focus();
  const t2 = Date.now();
  await panel.keyboard.press('End');
  await expect(panel.getByRole('row', { selected: true })).toContainText('49998');
  const jumpMs = Date.now() - t2;
  const longest = await panel.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let worst = 0;
        let last = performance.now();
        let n = 0;
        const list = document.querySelector('[role=grid]')!;
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          list.scrollTop = (n * 997) % list.scrollHeight;
          if (++n < 60) requestAnimationFrame(tick);
          else resolve(worst);
        };
        requestAnimationFrame(tick);
      }),
  );
  const heapMB = await panel.evaluate(() => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : -1;
  });
  const metrics = { startupMs, importMs, filterMs, filterRoundTripMs, jumpMs, longestScrollFrameMs: Math.round(longest), heapMB };
  console.info('[bench:e2e]', JSON.stringify(metrics));
  await info.attach('bench-50k.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(startupMs).toBeLessThan(1000);
  expect(filterMs).toBeLessThan(100);
  expect(longest).toBeLessThan(200);
});
