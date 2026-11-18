import type { Body, Captured, HarEntry } from './har.ts';
import { DEFAULT_REDACT, redactEntry, redactUrl, withExtra } from './redact.ts';
import { encodeToonItem, encodeToonRow, encodeToonTableHead, TOON_HEADER } from './toon.ts';

export const EXPORT_FORMAT = 'betterdevtools.export';
export const EXPORT_VERSION = 1;
export const FORMATS = ['har', 'json', 'ndjson', 'csv', 'toon'] as const;
export type ExportFormat = (typeof FORMATS)[number];

export interface ExportOptions {
  format: ExportFormat;
  /** `full`: headers, cookies, query and body; `summary`: method and URL only. */
  request: 'full' | 'summary';
  /** `full`: headers, cookies and body; `summary`: status and MIME type only. */
  response: 'full' | 'summary';
  bodies: boolean;
  timings: boolean;
  /** Adds `_bdt` with capture source, body state and truncation flags. */
  meta: boolean;
  /** Per-body cap in characters; 0 keeps bodies whole. */
  maxBodyChars: number;
  redact: boolean;
  extraSecrets: string[];
  creatorVersion: string;
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: 'har',
  request: 'full',
  response: 'full',
  bodies: true,
  timings: true,
  meta: true,
  maxBodyChars: 0,
  redact: true,
  extraSecrets: [],
  creatorVersion: '0.0.0',
};

function cut(text: string | undefined, max: number, base64: boolean): { text: string | undefined; cut: boolean } {
  if (text === undefined || !max || text.length <= max) return { text, cut: false };
  return { text: text.slice(0, base64 ? max - (max % 4) : max), cut: true };
}

export type ExportRecord = Omit<HarEntry, 'time' | 'timings'> & Partial<Pick<HarEntry, 'time' | 'timings'>>;

/** HAR entry with options, truncation and redaction applied; shared by every format. */
function shape(c: Captured, body: Body, o: ExportOptions): { entry: HarEntry; truncated: boolean } {
  const { request: rq, response: rs } = c.har;
  const wantBody = o.bodies && o.response === 'full' && body.text !== '';
  const res = cut(wantBody ? body.text : undefined, o.maxBodyChars, body.encoding === 'base64');
  const post = cut(o.bodies ? rq.postData?.text : undefined, o.maxBodyChars, false);
  const truncated = res.cut || body.state === 'truncated' || post.cut;
  const note = truncated ? 'Truncated by BetterDevTools' : undefined;

  const request =
    o.request === 'full'
      ? {
          ...rq,
          postData: rq.postData && {
            ...rq.postData,
            text: post.text,
            params: o.bodies ? rq.postData.params : undefined,
            comment: post.cut ? note : undefined,
          },
        }
      : {
          method: rq.method,
          url: rq.url,
          httpVersion: rq.httpVersion,
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        };
  const response =
    o.response === 'full'
      ? {
          ...rs,
          content: {
            ...rs.content,
            text: res.text,
            encoding: res.text === undefined ? undefined : body.encoding,
            comment: res.cut || body.state === 'truncated' ? note : undefined,
          },
        }
      : {
          status: rs.status,
          statusText: rs.statusText,
          httpVersion: rs.httpVersion,
          cookies: [],
          headers: [],
          content: { size: rs.content.size, mimeType: rs.content.mimeType },
          redirectURL: rs.redirectURL,
          headersSize: -1,
          bodySize: -1,
        };

  const entry: HarEntry = { ...c.har, request, response };
  return { entry: o.redact ? redactEntry(entry, withExtra(DEFAULT_REDACT, o.extraSecrets)) : entry, truncated };
}

/** One HAR 1.2 entry shaped by the options (HAR, JSON and NDJSON). */
export function exportRecord(c: Captured, body: Body, o: ExportOptions): ExportRecord {
  const { entry, truncated } = shape(c, body, o);
  const meta = o.meta
    ? { _bdt: { id: c.id, source: c.source, bodyState: body.state, truncated, redacted: o.redact, reason: body.reason } }
    : {};
  // HAR requires timings; the other formats can drop them
  if (!o.timings && o.format !== 'har') {
    const { timings: _timings, time: _time, ...rest } = entry;
    return { ...rest, ...meta };
  }
  return { ...entry, ...meta };
}

const pairs = (hs: { name: string; value: string }[]) => (hs.length ? hs.map(({ name, value }) => ({ name, value })) : undefined);

/** Columns of the agent/1 `requests` table (docs/toon.md); every row has all of them, null when absent. */
export const AGENT_COLUMNS = [
  'id',
  'started',
  'method',
  'url',
  'status',
  'statusText',
  'mime',
  'type',
  'durationMs',
  'sizeBytes',
  'error',
  'redirect',
  'bodyState',
];

export function agentRow(c: Captured, body: Body, o: ExportOptions): (string | number | null)[] {
  const rules = withExtra(DEFAULT_REDACT, o.extraSecrets);
  const url = (u: string) => (o.redact ? redactUrl(u, rules) : u) || null;
  const rs = c.har.response;
  return [
    c.id,
    c.har.startedDateTime,
    c.method,
    url(c.url),
    c.status,
    rs.statusText || null,
    c.mime || null,
    c.type || null,
    Math.round(c.duration * 10) / 10,
    c.size,
    c.error || null,
    url(c.redirect),
    body.state,
  ];
}

export const hasAgentDetails = (o: ExportOptions): boolean => o.request === 'full' || o.response === 'full' || o.timings;

/** agent/1 `details` item: headers, bodies and timings as the options ask; empty fields are omitted. */
export function agentDetail(c: Captured, body: Body, o: ExportOptions) {
  const { entry, truncated } = shape(c, body, o);
  const { request: rq, response: rs, timings: t } = entry;
  const full = (part: 'request' | 'response') => o[part] === 'full';
  return {
    id: c.id,
    requestHeaders: full('request') ? pairs(rq.headers) : undefined,
    requestBody: full('request') ? rq.postData?.text : undefined,
    responseHeaders: full('response') ? pairs(rs.headers) : undefined,
    responseBody: rs.content.text,
    responseEncoding: rs.content.text === undefined ? undefined : rs.content.encoding,
    timings: o.timings ? { blocked: t.blocked, dns: t.dns, connect: t.connect, send: t.send, wait: t.wait, receive: t.receive } : undefined,
    truncated: truncated || undefined,
  };
}

export const CSV_COLUMNS = [
  'id',
  'startedDateTime',
  'method',
  'url',
  'status',
  'statusText',
  'mimeType',
  'resourceType',
  'priority',
  'initiator',
  'durationMs',
  'sizeBytes',
  'bodyState',
  'error',
] as const;

/** RFC 4180 cell; text starting with = + - @ is prefixed with ' so spreadsheets never run it as a formula. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csvRow(c: Captured, body: Body, o: ExportOptions): string {
  const url = o.redact ? redactUrl(c.url, withExtra(DEFAULT_REDACT, o.extraSecrets)) : c.url;
  const cells = [c.id, c.har.startedDateTime, c.method, url, c.status, c.har.response.statusText, c.mime, c.type, c.priority, c.initiator];
  return [...cells, Math.round(c.duration), c.size, body.state, c.error].map(csvCell).join(',') + '\r\n';
}

/**
 * Streams an export as string chunks, one per entry plus envelope, so the caller can write them
 * to a Blob incrementally instead of building one giant string.
 */
export function* exportChunks(
  items: readonly Captured[],
  bodyOf: (id: number) => Body,
  o: ExportOptions,
  exportedAt = new Date().toISOString(),
): Generator<string> {
  const rec = (c: Captured) => exportRecord(c, bodyOf(c.id), o);
  const envelope = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt, count: items.length };
  switch (o.format) {
    case 'ndjson':
      for (const c of items) yield JSON.stringify(rec(c)) + '\n';
      return;
    case 'csv':
      yield CSV_COLUMNS.join(',') + '\r\n';
      for (const c of items) yield csvRow(c, bodyOf(c.id), o);
      return;
    case 'toon':
      // agent/1: one uniform table (no repeated keys), then optional per-request details
      yield `${TOON_HEADER}\nformat: ${EXPORT_FORMAT}\nversion: ${EXPORT_VERSION}\nprofile: agent/1\nexportedAt: ${JSON.stringify(exportedAt)}\ncount: ${items.length}\n`;
      yield encodeToonTableHead('requests', items.length, AGENT_COLUMNS, 0);
      for (const c of items) yield encodeToonRow(agentRow(c, bodyOf(c.id), o), 0);
      if (!hasAgentDetails(o)) return;
      yield `details[${items.length}]:\n`;
      for (const c of items) yield encodeToonItem(agentDetail(c, bodyOf(c.id), o), 1);
      return;
    case 'har':
    case 'json': {
      const head =
        o.format === 'har'
          ? { log: { version: '1.2', creator: { name: 'BetterDevTools', version: o.creatorVersion }, pages: [] } }
          : envelope;
      const open = JSON.stringify(head);
      // splice the entries array into the envelope's closing braces
      const close = o.format === 'har' ? ']}}' : ']}';
      yield `${open.slice(0, -(o.format === 'har' ? 2 : 1))},"entries":[`;
      let first = true;
      for (const c of items) {
        yield (first ? '' : ',') + JSON.stringify(rec(c));
        first = false;
      }
      yield close;
      return;
    }
  }
}
