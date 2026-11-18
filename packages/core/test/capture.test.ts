import { describe, expect, it } from 'vitest';
import { CaptureLog, compileFilter, makeBody, parseHar, summarize, takeBody, type Captured, ImportError } from '../src/index.ts';
import { sampleEntries, sampleHarText, syntheticEntry } from './fixtures.ts';

const logOf = (n: number, limits = { capacity: 100_000, maxBodyChars: 1 << 20, maxTotalBodyChars: 1 << 30 }) => {
  const log = new CaptureLog(limits);
  log.add(Array.from({ length: n }, (_, i) => ({ ...takeBody(syntheticEntry(i)), source: 'import' as const })));
  return log;
};

describe('HAR import', () => {
  it('keeps valid entries and counts invalid ones', () => {
    const { entries, skipped } = parseHar(sampleHarText);
    expect(entries).toHaveLength(6);
    expect(skipped).toBe(1);
  });

  it('rejects files that are not HAR without throwing raw errors', () => {
    expect(() => parseHar('{not json')).toThrow(ImportError);
    expect(() => parseHar('{"log":{}}')).toThrow(/log.entries/);
  });

  it('fills HAR defaults and keeps browser extensions', () => {
    const e = parseHar(
      '{"log":{"entries":[{"startedDateTime":"x","request":{"method":"get","url":"u"},"response":{"status":204},"_resourceType":"fetch"}]}}',
    ).entries[0]!;
    expect(e.request.headers).toEqual([]);
    expect(e.response.content).toEqual({ size: -1, mimeType: '' });
    expect(e._resourceType).toBe('fetch');
  });

  it('summarizes the fields filters and the list need', () => {
    const [ok, , , , failed] = sampleEntries().map((e, i) => summarize(e, i, 'import'));
    expect(ok).toMatchObject({
      method: 'GET',
      host: 'api.example.com',
      status: 200,
      mime: 'application/json',
      type: 'fetch',
      priority: 'High',
      initiator: 'script',
    });
    expect(failed).toMatchObject({ status: 0, error: 'net::ERR_BLOCKED_BY_CLIENT' });
  });

  it('separates bodies and labels missing ones', () => {
    const { har, body } = takeBody(sampleEntries()[0]!);
    expect(har.response.content.text).toBeUndefined();
    expect(body.state).toBe('available');
    expect(makeBody('', undefined, 120).state).toBe('unavailable');
    expect(makeBody('', undefined, 0).state).toBe('empty');
    expect(makeBody(null, undefined, 5).state).toBe('unavailable');
  });
});

describe('filters', () => {
  const rows = sampleEntries().map((e, i) => summarize(e, i, 'import'));
  const ids = (q: string, bodies: Record<number, string> = {}) =>
    rows.filter(compileFilter(q, (id) => bodies[id] ?? '')).map((c: Captured) => c.id);

  it('supports every documented key', () => {
    expect(ids('method:post')).toEqual([1, 2]);
    expect(ids('method:get,delete')).toEqual([0, 3, 4, 5]);
    expect(ids('domain:cdn.example')).toEqual([3]);
    expect(ids('status:5xx')).toEqual([5]);
    expect(ids('status:>=300')).toEqual([2, 5]);
    expect(ids('mime:png')).toEqual([3]);
    expect(ids('type:document')).toEqual([2]);
    expect(ids('duration:>100')).toEqual([0]);
    expect(ids('duration:<0.02s')).toEqual([3, 4]);
    expect(ids('size:>=60')).toEqual([0, 3, 5]);
    expect(ids('priority:low')).toEqual([3]);
    expect(ids('initiator:script')).toEqual([0]);
    expect(ids('origin:script')).toEqual([0]);
    expect(ids('is:error')).toEqual([4, 5]);
    expect(ids('is:redirect')).toEqual([2]);
    expect(ids('source:import')).toHaveLength(6);
    expect(ids('body:needle', { 3: 'a NEEDLE here' })).toEqual([3]);
  });

  it('searches response bodies with free text only when asked', () => {
    const bodies: Record<number, string> = { 2: 'Welcome back, Ada' };
    const withBodies = rows.filter(compileFilter('ada', (id) => bodies[id] ?? '', { searchBodies: true })).map((c) => c.id);
    const withoutBodies = rows.filter(compileFilter('ada', (id) => bodies[id] ?? '')).map((c) => c.id);
    expect(withBodies).toEqual([2]);
    expect(withoutBodies).toEqual([]);
  });

  it('combines terms, negates and falls back to text', () => {
    expect(ids('graphql')).toEqual([1]);
    expect(ids('example.com -method:get')).toEqual([1, 2, 5]);
    expect(ids('status:abc')).toEqual([]);
    expect(ids('constructor:x')).toEqual([]);
    expect(ids('   ')).toHaveLength(6);
  });
});

const big = (i: number) => ({ har: syntheticEntry(i), body: makeBody('x'.repeat(50), undefined, 50), source: 'live' as const });

describe('CaptureLog', () => {
  it('drops the oldest entries beyond capacity (ring buffer) and their bodies', () => {
    const log = logOf(50, { capacity: 20, maxBodyChars: 1000, maxTotalBodyChars: 1e9 });
    expect(log.entries).toHaveLength(20);
    expect(log.entries[0]!.id).toBe(31);
    expect(log.view.map((c) => c.id)).toEqual(log.entries.map((c) => c.id));
    expect(log.bodies.size).toBe(20);
    expect(log.body(1).state).toBe('discarded');
    expect(log.get(40)?.id).toBe(40);
    expect(log.get(5)).toBeUndefined();
  });

  it('filters incrementally as entries arrive', () => {
    const log = new CaptureLog();
    log.setQuery('method:post');
    log.add([0, 1, 2, 3].map((i) => ({ ...takeBody(syntheticEntry(i)), source: 'live' as const })));
    expect(log.view.map((c) => c.method)).toEqual(['POST']);
    const before = log.view;
    log.add([{ ...takeBody(syntheticEntry(9)), source: 'live' }]);
    expect(log.view).not.toBe(before); // replaced, so UIs can compare by reference
    expect(log.view).toHaveLength(2);
  });

  it('truncates long bodies and discards the oldest past the memory budget', () => {
    const log = new CaptureLog({ capacity: 100, maxBodyChars: 10, maxTotalBodyChars: 25 });
    log.add([big(0), big(1), big(2)]);
    expect(log.body(3).state).toBe('truncated');
    expect(log.body(3).text).toHaveLength(10);
    expect(log.body(1).state).toBe('discarded');
    expect(log.bodyChars).toBeLessThanOrEqual(25);
    const b64 = new CaptureLog({ capacity: 10, maxBodyChars: 10, maxTotalBodyChars: 100 });
    b64.add([{ har: syntheticEntry(0), body: makeBody('QUJDREVGR0hJSktM', 'base64', 12), source: 'live' }]);
    expect(b64.body(1).text).toBe('QUJDREVG');
  });

  it('gate: 50,000 entries ingest and filter within budget', () => {
    let t = performance.now();
    const log = logOf(50_000);
    const ingest = performance.now() - t;
    t = performance.now();
    log.setQuery('status:4xx method:get');
    const filter = performance.now() - t;
    t = performance.now();
    log.setQuery('items/4999');
    const text = performance.now() - t;
    console.info(`[bench] 50k ingest ${ingest.toFixed(0)} ms, field filter ${filter.toFixed(1)} ms, text filter ${text.toFixed(1)} ms`);
    expect(log.view.length).toBeGreaterThan(0);
    expect(filter).toBeLessThan(100);
    expect(text).toBeLessThan(100);
  });
});
