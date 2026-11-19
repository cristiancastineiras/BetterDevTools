import { describe, expect, it } from 'vitest';
import {
  buildExport,
  buildExportFiles,
  buildMarkdown,
  buildOpenApi,
  buildReportHtml,
  buildTypeScript,
  coverageOf,
  diffSessions,
  DiscoveryModel,
  layoutGraph,
  toYaml,
  emptySchemaAcc,
  exampleText,
  exampleUrl,
  inferSchema,
  makeBody,
  normalizePath,
  observeValue,
  sanitizeValue,
  schemaFindings,
  summarize,
  validateSchema,
  type HarEntry,
  type JsonSchema,
} from '../src/index.ts';

let counter = 0;

interface CallOptions {
  status?: number;
  request?: unknown;
  response?: unknown;
  requestHeaders?: { name: string; value: string }[];
  at?: number;
  type?: string;
  mime?: string;
  duration?: number;
}

/** A captured request for the model, built the way the panel builds one. */
function call(method: string, url: string, options: CallOptions = {}) {
  const {
    status = 200,
    request,
    response,
    requestHeaders = [],
    at = Date.UTC(2026, 0, 1) + counter * 100,
    type = 'fetch',
    mime = 'application/json',
    duration = 20,
  } = options;
  const responseText = response === undefined ? '' : JSON.stringify(response);
  const har = {
    startedDateTime: new Date(at).toISOString(),
    time: duration,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [...requestHeaders, ...(request === undefined ? [] : [{ name: 'content-type', value: 'application/json' }])],
      queryString: [],
      headersSize: -1,
      bodySize: -1,
      ...(request === undefined ? {} : { postData: { mimeType: 'application/json', text: JSON.stringify(request) } }),
    },
    response: {
      status,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [{ name: 'content-type', value: mime }],
      content: { size: responseText.length, mimeType: mime },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: {},
    _resourceType: type,
  } as unknown as HarEntry;
  return { captured: summarize(har, ++counter, 'live'), body: makeBody(responseText, undefined, responseText.length) };
}

function feed(model: DiscoveryModel, ...calls: ReturnType<typeof call>[]) {
  for (const { captured, body } of calls) model.observe(captured, body);
}

const short = (key: string) => key.replace('https://api.test', '');

const infer = (...samples: unknown[]): JsonSchema => {
  const acc = emptySchemaAcc();
  for (const sample of samples) observeValue(acc, sample);
  return inferSchema(acc);
};

function sampleModel() {
  const model = DiscoveryModel.create('Shop API');
  feed(
    model,
    call('POST', 'https://api.test/auth/login', {
      request: { user: 'a', password: 'x' },
      response: { token: 'tok_live_9f8e7d6c5b4a3210', expires: 3600 },
      requestHeaders: [],
    }),
    call('GET', 'https://api.test/v1/products', {
      response: [
        { id: 1, name: 'Pen', price: 1.5 },
        { id: 2, name: 'Ink', price: 2 },
      ],
      requestHeaders: [{ name: 'authorization', value: 'Bearer tok_live_9f8e7d6c5b4a3210' }],
    }),
    call('GET', 'https://api.test/v1/products/1', {
      response: { id: 1, name: 'Pen', price: 1.5, tags: ['a'] },
      requestHeaders: [{ name: 'authorization', value: 'Bearer tok_live_9f8e7d6c5b4a3210' }],
    }),
    call('GET', 'https://api.test/v1/products/2', {
      response: { id: 2, name: 'Ink', price: 2, tags: [] },
      requestHeaders: [{ name: 'authorization', value: 'Bearer tok_live_9f8e7d6c5b4a3210' }],
    }),
    call('GET', 'https://api.test/v1/products/9', { status: 404, response: { error: 'not found' } }),
  );
  return model;
}

describe('path normalisation', () => {
  it('turns ids into named parameters and leaves words alone', () => {
    expect(normalizePath('/api/users/123').template).toBe('/api/users/{userId}');
    expect(normalizePath('/api/users/123/orders/9').template).toBe('/api/users/{userId}/orders/{orderId}');
    expect(normalizePath('/v1/files/3f2b8c1e-9d4a-4f6e-8a3b-1c2d3e4f5a6b/versions').template).toBe('/v1/files/{fileId}/versions');
    expect(normalizePath('/api/users/me').template).toBe('/api/users/me');
    expect(normalizePath('/api/users/123').params).toEqual([{ name: 'userId', kind: 'integer', example: '123' }]);
    expect(normalizePath('/a/1/b/2/').template).toBe('/a/{aId}/b/{bId}');
    expect(normalizePath('/x/507f1f77bcf86cd799439011').template).toBe('/x/{xId}');
  });
});

describe('schema inference', () => {
  it('merges samples: nullable, optional, types, and says it is inferred', () => {
    const schema = infer(
      { id: 123, name: 'Cristian', email: 'test@example.com', active: true },
      { id: 456, name: 'Sarah', email: null, active: false, role: 'admin' },
    );
    expect(schema).toMatchObject({
      type: 'object',
      'x-inferred': true,
      'x-samples': 2,
      required: ['id', 'name', 'email', 'active'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: ['string', 'null'], format: 'email' },
        active: { type: 'boolean' },
        role: { type: 'string' },
      },
    });
    // "role" was in one sample of two: not required, but that does not prove it is optional
    expect((schema.required as string[]).includes('role')).toBe(false);
  });

  it('flags conflicting types, formats, enum candidates and mixed numbers', () => {
    const schema = infer(
      ...Array.from({ length: 6 }, (_, i) => ({
        when: '2026-01-02T03:04:05Z',
        state: i % 2 ? 'open' : 'closed',
        mixed: i % 2 ? 1 : 'one',
        n: i % 2 ? 1 : 1.5,
      })),
    ) as { properties: Record<string, JsonSchema> };
    expect(schema.properties.when).toMatchObject({ type: 'string', format: 'date-time' });
    expect(schema.properties.state).toMatchObject({ enum: ['closed', 'open'], 'x-enum-candidate': true });
    expect(schema.properties.mixed).toMatchObject({ 'x-inconsistent-types': true });
    expect(schema.properties.n).toMatchObject({ type: 'number' });
    const acc = emptySchemaAcc();
    observeValue(acc, { mixed: 1 });
    observeValue(acc, { mixed: 'x' });
    expect(schemaFindings(acc).map((f) => `${f.path}:${f.kind}`)).toEqual(['$.mixed:type-conflict']);
  });

  it('never offers personal fields as enums, and handles arrays and nesting', () => {
    const schema = infer(
      ...Array.from({ length: 8 }, (_, i) => ({ name: i % 2 ? 'Ana' : 'Luis', items: [{ sku: 'a' }, { sku: 'b', qty: 2 }] })),
    ) as {
      properties: Record<string, JsonSchema>;
    };
    expect(schema.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.items).toMatchObject({ type: 'array', items: { type: 'object', required: ['sku'] } });
  });

  it('validates values against an inferred schema', () => {
    const schema = infer({ id: 1, name: 'a', email: 'a@b.co' }, { id: 2, name: 'b', email: 'c@d.co' });
    expect(validateSchema(schema, { id: 3, name: 'c', email: 'e@f.co' })).toEqual([]);
    expect(validateSchema(schema, { id: 'x', name: 'c' }).map((i) => `${i.path}: ${i.message}`)).toEqual([
      '$.email: required field missing',
      '$.id: expected integer, received string',
    ]);
  });
});

describe('examples never keep credentials or personal data', () => {
  it('scrubs secrets, tokens, emails, cards and people', () => {
    const text = exampleText({
      token: 'abc',
      auth: { password: 'p' },
      jwt: 'eyJhbGciOi.eyJzdWIi.sig',
      mail: 'write to ana@example.com now',
      card: '4111 1111 1111 1111',
      email: 'ana@example.com',
      firstName: 'Ana',
      name: 'Ana',
      title: 'Hello',
      long: 'x'.repeat(500),
      list: [1, 2, 3, 4, 5],
    });
    expect(text).not.toMatch(/ana@example|4111|eyJ|Ana|"abc"|"p"/);
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('[card]');
    expect(text).toContain('[personal data]');
    expect(text).toContain('write to [email] now');
    expect(text).toContain('… 2 more');
    expect(JSON.stringify(sanitizeValue({ name: 'Plain product' }))).toContain('Plain product'); // no person nearby
  });

  it('masks URLs: credentials, fragments, secret query values and emails in the path', () => {
    const url = exampleUrl('https://user:pw@api.test/users/ana@example.com/profile?token=abc&page=2&email=ana@example.com#frag');
    expect(url).toBe('https://api.test/users/[email]/profile?token=[REDACTED]&page=2&email=[personal data]');
  });
});

describe('discovery model', () => {
  it('groups calls into one endpoint with parameters, and keeps look-alikes apart', () => {
    const model = DiscoveryModel.create('t');
    feed(
      model,
      call('GET', 'https://api.test/api/users/123', { response: { id: 123, name: 'A' } }),
      call('GET', 'https://api.test/api/users/456', { response: { id: 456, name: 'B' } }),
      call('GET', 'https://api.test/api/users/789?expand=team', { response: { id: 789, name: 'C' } }),
      call('GET', 'https://api.test/api/users/me', { response: { id: 1, name: 'Me' } }),
      call('GET', 'https://api.test/api/users', { response: [{ id: 1 }] }),
      call('GET', 'https://cdn.test/app.js', { type: 'script', mime: 'application/javascript' }),
      call('GET', 'https://api.test/index.html', { type: 'document', mime: 'text/html' }),
    );
    expect(model.state.seen).toBe(7);
    expect(model.state.ignored).toBe(2);
    const keys = Object.keys(model.state.endpoints).toSorted();
    expect(keys).toEqual([
      'GET https://api.test/api/users',
      'GET https://api.test/api/users/me',
      'GET https://api.test/api/users/{userId}',
    ]);
    const users = model.state.endpoints['GET https://api.test/api/users/{userId}']!;
    expect(users.calls).toBe(3);
    expect(users.query.expand).toMatchObject({ count: 1, examples: ['team'] });
    expect(model.schemaOf(users, '200')).toMatchObject({ type: 'object', required: ['id', 'name'], 'x-samples': 3 });
  });

  it('separates GraphQL operations of one URL', () => {
    const model = DiscoveryModel.create('t');
    feed(
      model,
      call('POST', 'https://api.test/graphql', {
        request: { operationName: 'GetUser', query: 'query GetUser { user { id } }', variables: { id: 1 } },
        response: { data: { user: { id: 1 } } },
      }),
      call('POST', 'https://api.test/graphql', {
        request: { query: 'mutation Save($x: Int) { save(x: $x) }', variables: { x: 2 } },
        response: { data: { save: true } },
      }),
    );
    expect(Object.keys(model.state.endpoints).toSorted()).toEqual([
      'POST https://api.test/graphql#GetUser',
      'POST https://api.test/graphql#Save',
    ]);
    expect(model.state.endpoints['POST https://api.test/graphql#GetUser']!.requestSchema).toBeDefined();
  });

  it('turns a literal into a parameter only with evidence, at consolidation', () => {
    const model = DiscoveryModel.create('t');
    const countries = ['spain', 'france', 'italy', 'germany', 'portugal'];
    feed(model, ...countries.map((name) => call('GET', `https://api.test/countries/${name}`, { response: { name, code: 'xx', pop: 1 } })));
    feed(
      model,
      call('GET', 'https://api.test/other/alpha', { response: { a: 1 } }),
      call('GET', 'https://api.test/other/beta', { response: { b: 'x' } }),
    );
    expect(Object.keys(model.state.endpoints)).toHaveLength(7);
    expect(model.consolidate()).toBe(4);
    const keys = Object.keys(model.state.endpoints).toSorted();
    expect(keys).toEqual([
      'GET https://api.test/countries/{country}',
      'GET https://api.test/other/alpha',
      'GET https://api.test/other/beta',
    ]);
    expect(model.state.endpoints['GET https://api.test/countries/{country}']!.calls).toBe(5);
  });

  it('records data dependencies (login token, ids) and temporal order', () => {
    const model = DiscoveryModel.create('t');
    const t0 = Date.UTC(2026, 0, 1);
    feed(
      model,
      call('POST', 'https://api.test/auth/login', {
        at: t0,
        request: { user: 'a' },
        response: { token: 'tok_live_9f8e7d6c5b4a3210', userId: 98765 },
      }),
      call('GET', 'https://api.test/api/profile', {
        at: t0 + 200,
        requestHeaders: [{ name: 'authorization', value: 'Bearer tok_live_9f8e7d6c5b4a3210' }],
        response: { id: 98765 },
      }),
      call('GET', 'https://api.test/api/users/98765/projects', { at: t0 + 400, response: [] }),
      call('GET', 'https://api.test/late', { at: t0 + 60_000, response: {} }),
    );
    const edges = Object.values(model.state.edges).map(
      (edge) =>
        `${edge.kind}: ${short(edge.from)} -> ${short(edge.to)} [${edge.evidence.map((e) => `${e.source} => ${e.target}`).join(', ')}]`,
    );
    expect(edges).toContain('data: POST /auth/login -> GET /api/profile [$.token => header authorization]');
    expect(edges).toContain('data: GET /api/profile -> GET /api/users/{userId}/projects [$.id => path]');
    expect(edges).toContain('temporal: POST /auth/login -> GET /api/profile []');
    // the call a minute later is not "after" the others
    expect(edges.some((edge) => edge.includes('/late'))).toBe(false);
    // values are never saved with the session
    expect(JSON.stringify(model.toJSON())).not.toContain('tok_live');
  });
});

describe('discovery export', () => {
  it('generates OpenAPI 3.1 with shared components, params, security and the inferred note', () => {
    const doc = buildOpenApi(sampleModel()) as {
      openapi: string;
      info: Record<string, unknown>;
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, unknown>; securitySchemes: unknown };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info['x-inferred']).toBe(true);
    const product = doc.paths['/v1/products/{productId}']!.get!;
    expect(product.parameters).toEqual([
      expect.objectContaining({ name: 'productId', in: 'path', required: true, schema: { type: 'integer' } }),
    ]);
    expect((product.responses as Record<string, unknown>)['404']).toBeDefined();
    expect(product.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components.securitySchemes).toEqual({ bearerAuth: { type: 'http', scheme: 'bearer' } });
    expect(Object.keys(doc.components.schemas)).toContain('Product');
    const list = doc.paths['/v1/products']!.get!.responses as Record<
      string,
      { content: Record<string, { schema: { items: { $ref: string } } }> }
    >;
    expect(list['200']!.content['application/json']!.schema.items.$ref).toBe('#/components/schemas/Product');
    // a credential never reaches the document
    expect(JSON.stringify(doc)).not.toMatch(/tok_live|"x"/);
  });

  it('writes YAML, TypeScript, Markdown, a report and a zip package', () => {
    const model = sampleModel();
    const yaml = toYaml(buildOpenApi(model));
    expect(yaml).toContain('openapi: "3.1.0"');
    expect(yaml).toContain('"/v1/products/{productId}":');
    expect(buildTypeScript(model)).toMatch(/export interface Product \{\n {2}id: number;\n {2}name: string;\n {2}price: number;/);
    expect(buildMarkdown(model)).toContain('### GET /v1/products/{productId}');
    expect(buildReportHtml(model)).toContain('<!doctype html>');
    const exported = buildExport(model, 'package');
    expect(exported.name).toBe('Shop-API-discovery-export.zip');
    const view = new DataView(exported.bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // a zip starts with a local file header
    expect(new TextDecoder().decode(exported.bytes)).toContain('discovery-export/openapi.yaml');
    expect(buildExportFiles(model, 'schemas').map((file) => file.path)).toContain('schemas/Product.schema.json');
  });

  it('computes coverage and freezes a contract that catches regressions', () => {
    const model = sampleModel();
    const before = coverageOf(model);
    expect(before.endpoints).toBe(3);
    expect(before.thinKeys.length).toBeGreaterThan(0);
    expect(before.erroring).toContain('GET https://api.test/v1/products/{productId}');
    expect(model.freeze()).toBe(3);
    feed(model, call('GET', 'https://api.test/v1/products/3', { response: { id: '3', name: 'Cap', price: 5 } }));
    const product = model.state.endpoints['GET https://api.test/v1/products/{productId}']!;
    expect(product.validation.failed).toBe(1);
    expect(product.validation.violations.map((v) => `${v.path}: ${v.message}`)).toContain('$.id: expected integer, received string');
    feed(model, call('GET', 'https://api.test/v1/brand-new', { response: { a: 1 } }));
    const after = coverageOf(model);
    expect(after.newSinceFreeze).toEqual(['GET https://api.test/v1/brand-new']);
    expect(after.unexercised.length).toBe(2);
  });

  it('compares two sessions', () => {
    const base = sampleModel();
    const next = sampleModel();
    feed(
      next,
      call('GET', 'https://api.test/v1/orders', { response: { id: 1 } }),
      call('GET', 'https://api.test/v1/products/5', { response: { id: 5, name: 'Cap', price: 'free' } }),
    );
    const diff = diffSessions(base, next);
    expect(diff.added).toEqual(['GET https://api.test/v1/orders']);
    expect(diff.changed[0]!.schemas[0]!.changes.map((c) => `${c.path} ${c.change}`)).toContain('$.price type');
  });

  it('lays out a dependency graph in layers', () => {
    const layout = layoutGraph(
      [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
      ],
      [
        { from: 'a', to: 'b', kind: 'data', count: 1 },
        { from: 'b', to: 'c', kind: 'data', count: 1 },
        { from: 'c', to: 'a', kind: 'data', count: 1 },
      ],
    );
    expect(layout.nodes.map((node) => [node.id, node.layer])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]); // the edge closing the cycle is ignored for layering
  });
});
