import { describe, expect, it } from 'vitest';
import {
  AGENT_COLUMNS,
  agentDetail,
  agentRow,
  CaptureLog,
  csvCell,
  decodeToon,
  DEFAULT_EXPORT,
  exportChunks,
  REDACTED,
  takeBody,
  type ExportOptions,
} from '../src/index.ts';
import { sampleEntries } from './fixtures.ts';

const log = new CaptureLog();
log.add(sampleEntries().map((e) => ({ ...takeBody(e), source: 'import' as const })));
const run = (o: Partial<ExportOptions>) =>
  [...exportChunks(log.entries, (id) => log.body(id), { ...DEFAULT_EXPORT, ...o }, '2026-01-01T00:00:00.000Z')].join('');

describe('exports', () => {
  it('HAR 1.2 is valid JSON with every entry and redacts by default', () => {
    const har = JSON.parse(run({ format: 'har', creatorVersion: '9.9.9' }));
    expect(har.log).toMatchObject({ version: '1.2', creator: { name: 'BetterDevTools', version: '9.9.9' } });
    expect(har.log.entries).toHaveLength(6);
    const first = har.log.entries[0];
    expect(first.request.headers).toContainEqual({ name: 'authorization', value: REDACTED });
    expect(first.request.url).toBe(`https://api.example.com/users/42?expand=roles&token=${REDACTED}&q=a%2Bb`);
    expect(first.response.headers).toContainEqual({ name: 'set-cookie', value: REDACTED });
    expect(first.response.content.text).toContain(`"password":"${REDACTED}"`);
    expect(first.response.content.text).toContain('12345678901234567890');
    expect(har.log.entries[2].request.postData.text).toBe(`user=ada&password=${REDACTED}&remember=1`);
    expect(first.timings).toBeDefined();
  });

  it('keeps secrets only when redaction is off', () => {
    const har = JSON.parse(run({ format: 'har', redact: false }));
    expect(har.log.entries[0].request.headers).toContainEqual({ name: 'authorization', value: 'Bearer live-secret' });
  });

  it('JSON and NDJSON carry the same HAR records', () => {
    const json = JSON.parse(run({ format: 'json' }));
    expect(json).toMatchObject({ format: 'betterdevtools.export', version: 1, count: 6 });
    const lines = run({ format: 'ndjson' })
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual(json.entries);
  });

  it('TOON (agent/1) decodes back to exactly the table and details, redacted', () => {
    const o = { ...DEFAULT_EXPORT, format: 'toon' as const };
    const text = run(o);
    expect(text).toContain(`requests[6]{${AGENT_COLUMNS.join(',')}}:`);
    const rows = log.entries.map((c) => Object.fromEntries(agentRow(c, log.body(c.id), o).map((v, i) => [AGENT_COLUMNS[i], v])));
    const details = log.entries.map((c) => agentDetail(c, log.body(c.id), o));
    expect(decodeToon(text)).toEqual(
      JSON.parse(
        JSON.stringify({
          format: 'betterdevtools.export',
          version: 1,
          profile: 'agent/1',
          exportedAt: '2026-01-01T00:00:00.000Z',
          count: 6,
          requests: rows,
          details,
        }),
      ),
    );
    expect(rows[0]).toMatchObject({
      method: 'GET',
      status: 200,
      bodyState: 'available',
      url: expect.stringContaining(`token=${REDACTED}`),
    });
    expect(rows[4]).toMatchObject({ error: 'net::ERR_BLOCKED_BY_CLIENT', statusText: null });
    expect(details[0]!.requestHeaders).toContainEqual({ name: 'authorization', value: REDACTED });
    expect(details[3]).toMatchObject({ responseEncoding: 'base64' });
    expect(details[4]!.responseBody).toBeUndefined();
    const lean = decodeToon(run({ ...o, request: 'summary', response: 'summary', timings: false }));
    expect(lean).not.toHaveProperty('details');
  });

  it('honours content options and flags truncation', () => {
    const [rec] = JSON.parse(run({ format: 'json', request: 'summary', response: 'full', maxBodyChars: 10, timings: false })).entries;
    expect(rec.request).toEqual({
      method: 'GET',
      url: expect.stringContaining('api.example.com'),
      httpVersion: 'HTTP/2',
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: -1,
      bodySize: -1,
    });
    expect(rec.response.content.text).toHaveLength(10);
    expect(rec.response.content.comment).toMatch(/Truncated/);
    expect(rec._bdt).toMatchObject({ truncated: true, bodyState: 'available', redacted: true });
    expect(rec.timings).toBeUndefined();
    const [bare] = JSON.parse(run({ format: 'json', bodies: false, meta: false })).entries;
    expect(bare.response.content.text).toBeUndefined();
    expect(bare._bdt).toBeUndefined();
  });

  it('marks unavailable bodies instead of inventing them', () => {
    const entries = JSON.parse(run({ format: 'json' })).entries;
    expect(entries[2]._bdt).toMatchObject({ bodyState: 'empty' });
    const failed = entries.find((e: { _bdt: { id: number } }) => e._bdt.id === 5);
    expect(failed.response.content.text).toBeUndefined();
  });

  it('CSV escapes cells and defuses spreadsheet formulas', () => {
    const csv = run({ format: 'csv' });
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe(
      'id,startedDateTime,method,url,status,statusText,mimeType,resourceType,priority,initiator,durationMs,sizeBytes,bodyState,error',
    );
    expect(rows[1]).toContain(`token=${REDACTED}`);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-1)).toBe('-1');
  });
});
