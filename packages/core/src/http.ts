export const METHOD_TOKENS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'connect'] as const;
export type MethodToken = (typeof METHOD_TOKENS)[number] | 'other';

/** Design-token suffix for a method (`--color-m-<token>`); unknown methods share a neutral token. */
export function methodToken(method: string): MethodToken {
  const m = method.toLowerCase();
  return METHOD_TOKENS.find((t) => t === m) ?? 'other';
}

export type StatusToken = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'error' | 'cancelled' | 'unknown';

/** Status class for badges; failed requests (status 0) are `error`, aborted ones `cancelled`. */
export function statusToken(status: number, error: string): StatusToken {
  if (!status) return /abort|cancel/i.test(error) ? 'cancelled' : error ? 'error' : 'unknown';
  return (['1xx', '2xx', '3xx', '4xx', '5xx'] as const)[Math.floor(status / 100) - 1] ?? 'unknown';
}
