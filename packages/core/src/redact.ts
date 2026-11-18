import type { HarEntry, Header } from './har.ts';

export const REDACTED = '[REDACTED]';

export interface RedactRules {
  headers: string[];
  params: string[];
}

export const DEFAULT_REDACT: RedactRules = {
  headers: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'x-csrf-token'],
  params: [
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'api_key',
    'apikey',
    'key',
    'password',
    'passwd',
    'secret',
    'client_secret',
    'signature',
    'sig',
    'session',
  ],
};

export function withExtra(rules: RedactRules, extra: string[]): RedactRules {
  const names = extra.map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { headers: [...rules.headers, ...names], params: [...rules.params, ...names] };
}

const has = (list: string[]) => (name: string) => list.includes(name.toLowerCase());

/** Masks `key=value` pairs in query strings and urlencoded bodies, keeping every other byte as is. */
function redactPairs(text: string, secret: (n: string) => boolean): string {
  return text.replace(/(^|[?&#])([^=&#?\s]+)=([^&#?\s]*)/g, (m, sep: string, k: string) => (secret(k) ? `${sep}${k}=${REDACTED}` : m));
}

/** Masks string values of secret-named keys in JSON text. */
function redactJson(text: string, secret: (n: string) => boolean): string {
  return text.replace(/"([^"\\]{1,64})"(\s*:\s*)"(?:[^"\\]|\\.)*"/g, (m, k: string, colon: string) =>
    secret(k) ? `"${k}"${colon}"${REDACTED}"` : m,
  );
}

export function redactUrl(url: string, rules: RedactRules): string {
  return redactPairs(url, has(rules.params));
}

export function redactText(text: string, rules: RedactRules): string {
  const secret = has(rules.params);
  return redactPairs(redactJson(text, secret), secret);
}

/** Secret-named headers are masked whole; URLs in the rest (Location, Referer…) lose their secret params. */
export function redactHeaders(headers: Header[], rules: RedactRules): Header[] {
  const secret = has(rules.headers);
  const param = has(rules.params);
  return headers.map((h) => (secret(h.name) ? { ...h, value: REDACTED } : { ...h, value: redactPairs(h.value, param) }));
}

const masked = <T extends { name: string; value: string }>(list: T[], secret: (n: string) => boolean) =>
  list.map((p) => (secret(p.name) ? { ...p, value: REDACTED } : p));
const all = () => true;

/** Returns a redacted copy; the input entry is never modified. */
export function redactEntry(e: HarEntry, rules: RedactRules = DEFAULT_REDACT): HarEntry {
  const param = has(rules.params);
  const { request: rq, response: rs } = e;
  const post = rq.postData;
  return {
    ...e,
    request: {
      ...rq,
      url: redactPairs(rq.url, param),
      headers: redactHeaders(rq.headers, rules),
      queryString: masked(rq.queryString, param),
      cookies: masked(rq.cookies, all),
      postData: post && {
        ...post,
        text: post.text === undefined ? undefined : redactText(post.text, rules),
        params: post.params?.map((p) => (param(p.name) ? { ...p, value: REDACTED } : p)),
      },
    },
    response: {
      ...rs,
      headers: redactHeaders(rs.headers, rules),
      cookies: masked(rs.cookies, all),
      redirectURL: redactPairs(rs.redirectURL, param),
      content:
        rs.content.text === undefined || rs.content.encoding ? rs.content : { ...rs.content, text: redactText(rs.content.text, rules) },
    },
  };
}

/** Deep copy with secret-named keys masked; used for local structured logs. */
export function redactDeep(value: unknown, rules: RedactRules = DEFAULT_REDACT, depth = 0): unknown {
  if (depth > 8 || typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, rules, depth + 1));
  const secret = (k: string) => has(rules.headers)(k) || has(rules.params)(k);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secret(k) ? REDACTED : redactDeep(v, rules, depth + 1)]));
}
