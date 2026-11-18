import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { choose, expect, importHar, test } from './fixtures.ts';

const USER_JSON = '{"id":12345678901234567890,"name":"Ada","surname":"Adams","address":{"city":"London","zip":"N1"},"tags":["a","b"]}';

const HAR = JSON.stringify({
  log: {
    entries: [
      {
        startedDateTime: new Date().toISOString(),
        time: 12,
        request: {
          method: 'GET',
          url: 'https://api.example.com/api/user',
          httpVersion: 'HTTP/1.1',
          headers: [{ name: 'accept', value: 'application/json' }],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          headers: [{ name: 'content-type', value: 'application/json' }],
          cookies: [],
          content: { size: USER_JSON.length, mimeType: 'application/json', text: USER_JSON },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 1, wait: 8, receive: 3 },
      },
    ],
  },
});

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(blocking.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('the separator between the list and the details resizes by keyboard and pointer', async ({ panel }) => {
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  const separator = panel.getByRole('separator', { name: 'Resize the request list and details' });
  const details = panel.getByRole('article', { name: 'Request details' });
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  const startWidth = (await details.boundingBox())!.width;

  await separator.focus();
  for (let step = 0; step < 5; step++) await panel.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '60');
  expect((await details.boundingBox())!.width).toBeGreaterThan(startWidth);

  const handle = (await separator.boundingBox())!;
  await panel.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(handle.x + 150, handle.y + handle.height / 2, { steps: 5 });
  await panel.mouse.up();
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBeLessThan(60);

  // the size is a preference: it survives a reload
  const saved = await separator.getAttribute('aria-valuenow');
  await panel.waitForTimeout(400); // preferences are saved shortly after the last change
  await panel.reload();
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', saved!);
});

test('header sections fold like an accordion, one by one or all together', async ({ panel }) => {
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  const responseHeaders = panel.getByRole('button', { name: /^Response headers/ });
  const general = panel.getByRole('button', { name: /^General/ });
  await expect(responseHeaders).toHaveAttribute('aria-expanded', 'true');
  await responseHeaders.click();
  await expect(responseHeaders).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('region', { name: 'Response headers' }).getByText('content-type')).toBeHidden();

  await panel.getByRole('button', { name: 'Collapse all sections' }).click();
  await expect(general).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('button', { name: 'Expand all sections' }).click();
  await expect(general).toHaveAttribute('aria-expanded', 'true');
  await expect(responseHeaders).toHaveAttribute('aria-expanded', 'true'); // the hand-closed one follows too
});

test('find in the response body highlights matches and steps through them', async ({ panel }) => {
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  await panel.getByRole('tab', { name: 'Response' }).click();
  const find = panel.getByRole('searchbox', { name: 'Find in body' });
  const pretty = panel.getByRole('region', { name: 'Response body (Pretty)' });
  await find.fill('ada');
  await expect(pretty.locator('mark')).toHaveCount(2);
  await expect(panel.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();
  await expect(pretty.locator('mark[data-current]')).toHaveText('Ada');
  await find.press('Enter');
  await expect(panel.getByRole('status').filter({ hasText: '2 of 2' })).toBeVisible();
  await find.press('Shift+Enter');
  await expect(panel.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();

  await panel.getByRole('button', { name: 'Match case' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'No matches' })).toBeVisible();
  await expect(pretty.locator('mark')).toHaveCount(0);
  await find.press('Escape');
  await expect(find).toHaveValue('');
});

test('JSON responses open as a collapsible tree with exact numbers', async ({ panel }) => {
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  await panel.getByRole('tab', { name: 'Response' }).click();
  await panel.getByRole('radio', { name: 'Tree' }).click();
  const tree = panel.getByRole('region', { name: 'Response body tree' });
  await expect(tree).toContainText('12345678901234567890'); // not rounded to 12345678901234567000
  await expect(tree).not.toContainText('London');
  await tree.getByRole('button', { name: /address/ }).click();
  await expect(tree).toContainText('London');

  await tree.getByRole('button', { name: 'Collapse all' }).click();
  await expect(tree).not.toContainText('Ada');
  await tree.getByRole('button', { name: 'Expand all' }).click();
  await expect(tree).toContainText('London');
  await axe(panel, 'json tree');
});

test('replay picks the method from a select', async ({ panel }) => {
  await importHar(panel, 'p3.har', HAR);
  await panel.getByRole('row', { name: /\/api\/user/ }).click();
  await panel.getByRole('button', { name: 'Replay', exact: true }).click();
  const method = panel.getByRole('button', { name: /^Method:/ });
  await expect(method).toHaveAccessibleName('Method: GET');
  await choose(panel, 'Method', 'PUT');
  await expect(method).toHaveAccessibleName('Method: PUT');
  await expect(panel.getByRole('button', { name: /^Send from:/ })).toBeDisabled(); // outside DevTools only the extension can send
});

test('the interface switches to Spanish and remembers it', async ({ panel }) => {
  await panel.getByRole('button', { name: 'Settings' }).click();
  const settings = panel.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await settings.getByRole('radio', { name: 'Español' }).click();
  await expect(panel.getByRole('dialog', { name: 'Ajustes' })).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Red' })).toBeVisible();
  await axe(panel, 'settings in Spanish');
  await panel.keyboard.press('Escape');

  await panel.waitForTimeout(400); // preferences are saved shortly after the last change
  await panel.reload();
  await expect(panel.getByRole('tab', { name: 'Colecciones' })).toBeVisible();
  await expect(panel.locator('html')).toHaveAttribute('lang', 'es');
});
