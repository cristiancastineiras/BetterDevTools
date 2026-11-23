import { base64ToBytesLoose, bytesToBase64 } from './encode.ts';
import { hmac, toHex, type HashName } from './hash.ts';

export const WEBHOOK_PROVIDERS = ['github', 'stripe', 'slack', 'generic'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export interface WebhookCheck {
  provider: WebhookProvider;
  secret: string;
  /** The body exactly as it was received: one changed byte changes the signature. */
  body: string;
  /** The signature header (GitHub X-Hub-Signature-256, Stripe-Signature, Slack X-Slack-Signature, or any HMAC). */
  header: string;
  /** Slack's X-Slack-Request-Timestamp. */
  timestamp?: string;
  /** Only for `generic`. */
  algorithm?: HashName;
  encoding?: 'hex' | 'base64';
  now?: number;
}

export type WebhookResult =
  | { ok: true; expected: string; stale: boolean }
  | { ok: false; reason: 'mismatch' | 'malformed' | 'missing'; expected: string; message: string };

const TOLERANCE_SECONDS = 300;
const enc = new TextEncoder();
const sign = async (algorithm: HashName, secret: string, message: string) => hmac(algorithm, enc.encode(secret), enc.encode(message));
const strip = (value: string) => value.trim().replace(/^(sha1|sha256|sha512|v0|v1)=/i, '');

const mismatch = (expected: string): WebhookResult => ({
  ok: false,
  reason: 'mismatch',
  expected,
  message: 'The signature does not match: wrong secret, or the body was changed',
});

/** Recomputes a webhook signature and compares it with the one received. Everything happens locally. */
export async function verifyWebhook(check: WebhookCheck): Promise<WebhookResult> {
  const now = check.now ?? Date.now();
  if (!check.secret) return { ok: false, reason: 'missing', expected: '', message: 'Enter the signing secret' };
  if (!check.header.trim()) return { ok: false, reason: 'missing', expected: '', message: 'Paste the signature header' };

  if (check.provider === 'stripe') {
    const fields = check.header.split(',').map((part) => part.trim().split('=') as [string, string]);
    const timestamp = fields.find(([k]) => k === 't')?.[1];
    const signatures = fields.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!timestamp || !signatures.length)
      return { ok: false, reason: 'malformed', expected: '', message: 'Expected "t=<timestamp>,v1=<signature>"' };
    const expected = toHex(await sign('sha256', check.secret, `${timestamp}.${check.body}`));
    if (!signatures.includes(expected)) return mismatch(expected);
    return { ok: true, expected, stale: Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS };
  }
  if (check.provider === 'slack') {
    const timestamp = (check.timestamp ?? '').trim();
    if (!timestamp) return { ok: false, reason: 'missing', expected: '', message: 'Enter X-Slack-Request-Timestamp' };
    const expected = toHex(await sign('sha256', check.secret, `v0:${timestamp}:${check.body}`));
    return strip(check.header).toLowerCase() === expected
      ? { ok: true, expected, stale: Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS }
      : mismatch(expected);
  }
  const algorithm: HashName =
    check.provider === 'github' ? (/^sha1=/i.test(check.header.trim()) ? 'sha1' : 'sha256') : (check.algorithm ?? 'sha256');
  const digest = await sign(algorithm, check.secret, check.body);
  const encoding = check.provider === 'github' ? 'hex' : (check.encoding ?? 'hex');
  const expected = encoding === 'hex' ? toHex(digest) : bytesToBase64(digest);
  const received = strip(check.header);
  const same = encoding === 'hex' ? received.toLowerCase() === expected : bytesToBase64(safeBase64(received)) === expected;
  return same ? { ok: true, expected, stale: false } : mismatch(expected);
}

function safeBase64(text: string): Uint8Array {
  try {
    return base64ToBytesLoose(text);
  } catch {
    return new Uint8Array();
  }
}
