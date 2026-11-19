import { describe, expect, it } from 'vitest';
import { createWorkspace, exportCollections, type Workspace } from '../src/index.ts';

function sample(): Workspace {
  const ws = createWorkspace('Demo');
  ws.envs[0]!.vars = [
    { key: 'base', value: 'https://api.example.com', secret: false },
    { key: 'token', value: 's3cret', secret: true },
  ];
  ws.collections[0]!.children = [
    {
      kind: 'request',
      id: 'r1',
      name: 'Create user',
      method: 'POST',
      url: '{{base}}/users',
      query: 'dry=1',
      headers: 'Content-Type: application/json\nAuthorization: Bearer {{token}}',
      body: '{"name":"it\'s"}',
    },
  ];
  return ws;
}

describe('collection export', () => {
  it('writes a Postman 2.1 collection, keeping variables and blanking secrets', () => {
    const doc = JSON.parse(exportCollections(sample(), 'postman', { includeSecrets: false }));
    expect(doc.info.schema).toContain('v2.1.0');
    expect(doc.item[0].item[0].request).toMatchObject({ method: 'POST', url: '{{base}}/users?dry=1' });
    expect(doc.variable).toEqual([
      { key: 'base', value: 'https://api.example.com', type: 'default' },
      { key: 'token', value: '', type: 'secret' },
    ]);
    expect(JSON.parse(exportCollections(sample(), 'postman', { includeSecrets: true })).variable[1].value).toBe('s3cret');
  });

  it('reads secret variables from the shell in scripts, and quotes everything else', () => {
    const curl = exportCollections(sample(), 'curl', { includeSecrets: false });
    expect(curl).toContain("curl -X POST 'https://api.example.com/users?dry=1'");
    expect(curl).toContain(`-H 'Authorization: Bearer '"\${token}"`);
    expect(curl).toContain(String.raw`--data-raw '{"name":"it'\''s"}'`);
    expect(curl).toContain('# Set these before running: token');
    expect(curl).not.toContain('s3cret');
    expect(exportCollections(sample(), 'curl', { includeSecrets: true })).toContain("'Authorization: Bearer s3cret'");
    expect(exportCollections(sample(), 'httpie', { includeSecrets: false })).toContain("http --ignore-stdin POST 'https://api.example.com/users?dry=1'");
  });

  it('describes operations in OpenAPI 3', () => {
    const doc = JSON.parse(exportCollections(sample(), 'openapi', { includeSecrets: false }));
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
    const operation = doc.paths['/users'].post;
    expect(operation.tags).toEqual(['My collection']);
    expect(operation.parameters).toEqual([{ name: 'dry', in: 'query', schema: { type: 'string' }, example: '1' }]);
    expect(operation.requestBody.content['application/json'].example).toEqual({ name: "it's" });
  });

  it('skips what OpenAPI cannot describe and says so', () => {
    const ws = sample();
    ws.envs[0]!.vars = [];
    const doc = JSON.parse(exportCollections(ws, 'openapi', { includeSecrets: false }));
    expect(doc.paths).toEqual({});
    expect(doc.info.description).toContain('1 request(s) were skipped');
  });
});
