export interface UrlParam {
  key: string;
  value: string;
  /** The text as it appears in the URL, before decoding. */
  raw: string;
}

export interface ParsedUrl {
  parts: { name: string; value: string }[];
  query: UrlParam[];
  hash: UrlParam[];
  segments: string[];
  warnings: ('credentials' | 'double-encoded' | 'invalid-escape' | 'punycode' | 'insecure')[];
}

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
};

const paramsOf = (text: string): UrlParam[] =>
  text
    .split('&')
    .filter(Boolean)
    .map((raw) => {
      const at = raw.indexOf('=');
      return { key: decode(at < 0 ? raw : raw.slice(0, at)), value: at < 0 ? '' : decode(raw.slice(at + 1)), raw };
    });

/** Breaks a URL into its parts, query and hash parameters, and lists what looks wrong with it. */
export function parseUrlText(text: string): ParsedUrl | null {
  const url = URL.parse(text.trim());
  if (!url) return null;
  const warnings: ParsedUrl['warnings'] = [];
  if (url.username || url.password) warnings.push('credentials');
  if (/%25[0-9a-f]{2}/i.test(url.href)) warnings.push('double-encoded');
  if (/%(?![0-9a-f]{2})/i.test(text)) warnings.push('invalid-escape');
  if (url.hostname.includes('xn--')) warnings.push('punycode');
  if (url.protocol === 'http:' || url.protocol === 'ws:') warnings.push('insecure');
  const parts = (
    [
      ['href', url.href],
      ['origin', url.origin],
      ['protocol', url.protocol],
      ['username', url.username],
      ['password', url.password],
      ['host', url.host],
      ['hostname', url.hostname],
      ['port', url.port],
      ['pathname', url.pathname],
      ['search', url.search],
      ['hash', url.hash],
    ] as const
  )
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ({ name, value }));
  // a fragment such as #/route?token=x carries parameters after its own question mark
  const fragment = url.hash.slice(1);
  const hashQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment.includes('=') ? fragment : '';
  return {
    parts,
    query: paramsOf(url.search.slice(1)),
    hash: paramsOf(hashQuery),
    segments: url.pathname.split('/').filter(Boolean).map(decode),
    warnings,
  };
}
