import * as v from 'valibot';

// HAR 1.2 entry, lenient on input (browsers omit fields) and complete on output (defaults fill the
// required fields). looseObject keeps browser extensions such as _resourceType or _error.
const Pair = v.looseObject({ name: v.string(), value: v.string() });
const pairs = () => v.optional(v.array(Pair), () => []);
const num = (d: number) => v.optional(v.number(), d);
const str = () => v.optional(v.string(), '');

export const HarEntrySchema = v.looseObject({
  startedDateTime: v.string(),
  time: num(0),
  request: v.looseObject({
    method: v.string(),
    url: v.string(),
    httpVersion: str(),
    cookies: pairs(),
    headers: pairs(),
    queryString: pairs(),
    postData: v.optional(
      v.looseObject({
        mimeType: str(),
        text: v.optional(v.string()),
        params: v.optional(v.array(v.looseObject({ name: v.string(), value: v.optional(v.string()) }))),
      }),
    ),
    headersSize: num(-1),
    bodySize: num(-1),
  }),
  response: v.looseObject({
    status: v.number(),
    statusText: str(),
    httpVersion: str(),
    cookies: pairs(),
    headers: pairs(),
    content: v.optional(
      v.looseObject({ size: num(-1), mimeType: str(), text: v.optional(v.string()), encoding: v.optional(v.string()) }),
      () => ({}),
    ),
    redirectURL: str(),
    headersSize: num(-1),
    bodySize: num(-1),
  }),
  cache: v.optional(v.looseObject({}), () => ({})),
  timings: v.optional(
    v.looseObject({ blocked: num(-1), dns: num(-1), connect: num(-1), ssl: num(-1), send: num(0), wait: num(0), receive: num(0) }),
    () => ({}),
  ),
});

export type HarEntry = v.InferOutput<typeof HarEntrySchema>;
export type Header = { name: string; value: string };

export type Source = 'live' | 'backfill' | 'import';
export type BodyState = 'available' | 'truncated' | 'empty' | 'unavailable' | 'discarded';

/** Response body kept outside reactive state; `text` is base64 when `encoding` says so. */
export interface Body {
  state: BodyState;
  text: string;
  encoding?: 'base64' | undefined;
  /** Size of the original body in bytes when known. */
  size: number;
  reason?: string | undefined;
}

/** A captured entry plus the derived fields the list, filters and CSV need. */
export interface Captured {
  id: number;
  source: Source;
  har: HarEntry;
  method: string;
  url: string;
  host: string;
  path: string;
  status: number;
  mime: string;
  type: string;
  priority: string;
  initiator: string;
  started: number;
  duration: number;
  size: number;
  error: string;
  redirect: string;
  /** Lower-case text the free-text filter searches. */
  hay: string;
}

const str0 = (x: unknown) => (typeof x === 'string' ? x : '');

export function summarize(har: HarEntry, id: number, source: Source): Captured {
  const { request: rq, response: rs } = har;
  const url = URL.parse(rq.url);
  const init = har._initiator;
  const initiator = typeof init === 'object' && init !== null && 'type' in init ? str0(init.type) : str0(init);
  return {
    id,
    source,
    har,
    method: rq.method.toUpperCase(),
    url: rq.url,
    host: url?.host ?? '',
    path: url ? url.pathname + url.search : rq.url,
    status: rs.status,
    mime: (rs.content.mimeType.split(';')[0] ?? '').trim(),
    type: str0(har._resourceType),
    priority: str0(har._priority),
    initiator,
    started: Date.parse(har.startedDateTime) || 0,
    duration: har.time,
    size: Math.max(rs.content.size, 0),
    error: str0(rs._error) || (rs.status === 0 ? 'failed' : ''),
    redirect: rs.redirectURL,
    hay: `${rq.method} ${rq.url} ${rs.status} ${rs.content.mimeType}`.toLowerCase(),
  };
}

export function makeBody(text: string | null, encoding: string | undefined, size: number, reason?: string): Body {
  if (text === null) {
    return { state: 'unavailable', text: '', size: Math.max(size, 0), reason: reason ?? 'The browser kept no body for this request' };
  }
  if (text === '' && size > 0) {
    return { state: 'unavailable', text: '', size, reason: reason ?? 'The page read this body as a stream or blob; DevTools kept no copy' };
  }
  if (text === '') return { state: 'empty', text: '', size: 0 };
  return { state: 'available', text, encoding: encoding === 'base64' ? 'base64' : undefined, size: size > 0 ? size : text.length };
}

/** Moves response.content.text out of the entry so the body lives in one place only. */
export function takeBody(har: HarEntry): { har: HarEntry; body: Body } {
  const { text, encoding, ...content } = har.response.content;
  return {
    har: { ...har, response: { ...har.response, content } },
    // no text and no size means there was no body at all, not that it was lost
    body: makeBody(text ?? (content.size > 0 ? null : ''), encoding, content.size, 'The file has no body for this entry'),
  };
}

export class ImportError extends Error {}

export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

/** Parses an untrusted HAR file. Invalid entries are skipped and counted, never half-imported. */
export function parseHar(text: string): { entries: HarEntry[]; skipped: number } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (cause) {
    throw new ImportError('The file is not valid JSON', { cause });
  }
  const top = v.safeParse(v.object({ log: v.object({ entries: v.array(v.unknown()) }) }), doc);
  if (!top.success) throw new ImportError('Not a HAR file: log.entries is missing');
  const entries: HarEntry[] = [];
  let skipped = 0;
  for (const raw of top.output.log.entries) {
    const r = v.safeParse(HarEntrySchema, raw);
    if (r.success) entries.push(r.output);
    else skipped++;
  }
  return { entries, skipped };
}
