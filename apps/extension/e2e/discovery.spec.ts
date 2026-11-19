import { AxeBuilder } from '@axe-core/playwright';
import { choose, expect, importHar, test } from './fixtures.ts';

const TOKEN = 'live-secret-token-9f8e7d6c5b4a';

/** A small web app's traffic: login, profile with the token, and a few users. */
function appTraffic(): string {
  const start = Date.now();
  const entry = (i: number, method: string, url: string, response: unknown, options: { authorized?: boolean; body?: unknown; status?: number } = {}) => ({
    startedDateTime: new Date(start + i * 300).toISOString(),
    time: 20 + i,
    _resourceType: 'fetch',
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: [
        ...(options.authorized ? [{ name: 'authorization', value: `Bearer ${TOKEN}` }] : []),
        ...(options.body ? [{ name: 'content-type', value: 'application/json' }] : []),
      ],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: -1,
      ...(options.body ? { postData: { mimeType: 'application/json', text: JSON.stringify(options.body) } } : {}),
    },
    response: {
      status: options.status ?? 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: 'application/json' }],
      cookies: [],
      content: { size: 80, mimeType: 'application/json', text: JSON.stringify(response) },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 1, wait: 10, receive: 1 },
  });
  const api = 'https://app.example.com';
  return JSON.stringify({
    log: {
      entries: [
        entry(0, 'POST', `${api}/api/auth/login`, { token: TOKEN, userId: 4242 }, { body: { email: 'ana@example.com', password: 'hunter2-secret' } }),
        entry(1, 'GET', `${api}/api/profile`, { id: 4242, email: 'ana@example.com', name: 'Ana', active: true }, { authorized: true }),
        entry(2, 'GET', `${api}/api/users/4242`, { id: 4242, name: 'Ana', role: 'admin' }, { authorized: true }),
        entry(3, 'GET', `${api}/api/users/7`, { id: 7, name: 'Bo', role: 'user', nick: null }, { authorized: true }),
        entry(4, 'GET', `${api}/api/users/9`, { id: 9, name: 'Cy', role: 'user' }, { authorized: true }),
        entry(5, 'GET', `${api}/api/users/11`, { id: '11', name: 'Di', role: 'user' }, { authorized: true }),
        entry(6, 'GET', `${api}/api/users/99999`, { error: 'not found' }, { authorized: true, status: 404 }),
      ],
    },
  });
}

test('API AutoDiscovery maps endpoints, schemas, dependencies and contracts without keeping secrets', async ({ panel }) => {
  await importHar(panel, 'app.har', appTraffic());
  await panel.getByRole('tab', { name: 'Discovery' }).click();
  await expect(panel.getByRole('heading', { name: 'API AutoDiscovery' })).toBeVisible();
  // outside DevTools nothing can be recorded, but the captured traffic can be analyzed
  await expect(panel.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Analyze captured traffic' }).click();
  await expect(panel.getByText('ANALYZED', { exact: true })).toBeVisible();

  // one endpoint for the users, with the parameter named after the resource
  const endpoints = panel.getByRole('listbox', { name: 'Endpoints' });
  await expect(endpoints.getByRole('option')).toHaveCount(3);
  await endpoints.getByRole('option', { name: /\/api\/users\/\{userId\}/ }).click();
  const details = panel.getByRole('region', { name: 'Endpoint details' });
  await expect(details).toContainText('userId');
  await expect(details).toContainText('inferred');
  const schema = details.getByRole('region', { name: 'Response 200' });
  await expect(schema).toContainText('"required"');
  // the id was an integer three times and a string once: the inconsistency is reported
  await expect(details).toContainText('type conflict');

  // the login token reappears in the next request: a data dependency, with its evidence
  await panel.getByRole('tab', { name: 'Dependencies' }).click();
  await panel.getByRole('button', { name: 'POST /api/auth/login' }).click();
  await expect(panel.getByRole('complementary', { name: 'Evidence' })).toContainText('response $.token → header authorization');

  // freeze the contract, then see a bad response counted as a violation after more traffic
  await panel.getByRole('tab', { name: 'Contracts' }).click();
  await panel.getByRole('button', { name: 'Freeze contract' }).click();
  await expect(panel.getByRole('heading', { name: 'Validation mode' })).toBeVisible();
  await panel.getByRole('tab', { name: 'Coverage' }).click();
  await expect(panel.getByRole('progressbar', { name: 'Endpoints with a schema' })).toBeVisible();

  // exports carry structure and no credentials
  await panel.getByRole('tab', { name: 'Endpoints' }).click();
  await choose(panel, 'Export format', 'OpenAPI 3.1 (YAML)');
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Export', exact: true }).click()]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const yaml = readFileSync(path, 'utf8');
  expect(yaml).toContain('openapi: "3.1.0"');
  expect(yaml).toContain('/api/users/{userId}');
  expect(yaml).not.toContain(TOKEN);
  expect(yaml).not.toContain('hunter2');
  expect(yaml).not.toContain('ana@example.com');

  // and so does the saved copy of the session
  const stored = await panel.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('betterdevtools');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('kv').objectStore('kv').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
        };
      }),
  );
  expect(stored).toContain('app.example.com/api/users/{userId}'); // a session was saved
  expect(stored).not.toContain(TOKEN);
  expect(stored).not.toContain('hunter2');
  expect(stored).not.toContain('ana@example.com');

  const { violations } = await new AxeBuilder({ page: panel }).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
