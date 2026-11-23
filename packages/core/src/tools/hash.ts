import { crc32 } from '../discovery/zip.ts';
import { base64ToBytesLoose, bytesToBase64 } from './encode.ts';

export const HASHES = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;
export type HashName = (typeof HASHES)[number];

const SUBTLE: Record<Exclude<HashName, 'md5'>, string> = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
const BLOCK_BYTES = 64; // md5 and sha1/256 use 64-byte blocks; only the manual HMAC (md5) needs it

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const SINES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 (RFC 1321). Broken for security, still the checksum many systems print. */
export function md5(data: Uint8Array): Uint8Array {
  const total = ((data.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(total);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, (data.length * 8) >>> 0, true);
  view.setUint32(total - 4, Math.floor(data.length / 2 ** 29), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let chunk = 0; chunk < total; chunk += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (f + a + SINES[i]! + view.getUint32(chunk + g * 4, true)) | 0;
      [a, d, c] = [d, c, b];
      b = (b + rotl(sum, SHIFTS[(i >> 4) * 4 + (i % 4)]!)) | 0;
    }
    [a0, b0, c0, d0] = [(a0 + a) | 0, (b0 + b) | 0, (c0 + c) | 0, (d0 + d) | 0];
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word >>> 0, true));
  return out;
}

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

export async function digest(name: HashName, bytes: Uint8Array): Promise<Uint8Array> {
  if (name === 'md5') return md5(bytes);
  return new Uint8Array(await crypto.subtle.digest(SUBTLE[name], bytes as BufferSource));
}

export async function hmac(name: HashName, key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (name !== 'md5') {
    const imported = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: SUBTLE[name] }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, message as BufferSource));
  }
  const block = key.length > BLOCK_BYTES ? md5(key) : key;
  const pad = (byte: number) => Uint8Array.from({ length: BLOCK_BYTES }, (_, i) => (block[i] ?? 0) ^ byte);
  return md5(Uint8Array.from([...pad(0x5c), ...md5(Uint8Array.from([...pad(0x36), ...message]))]));
}

export interface HashRow {
  name: string;
  hex: string;
}

/** Every checksum of a text at once (UTF-8 bytes), for the Hash tool. */
export async function hashAll(text: string): Promise<HashRow[]> {
  const bytes = new TextEncoder().encode(text);
  const rows: HashRow[] = [];
  for (const name of HASHES) rows.push({ name: name.toUpperCase(), hex: toHex(await digest(name, bytes)) });
  rows.push({ name: 'CRC32', hex: crc32(bytes).toString(16).padStart(8, '0') });
  return rows;
}

// ---------------------------------------------------------------------------------- JWT signatures

const HMAC_JWT: Record<string, HashName> = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };

export type JwtVerification = { status: 'valid' | 'invalid' } | { status: 'unsupported'; reason: string };

/**
 * Checks an HMAC-signed JWT (HS256/384/512) against a secret. shortcut: RSA and ECDSA tokens are
 * decoded but not verified; add a public-key field when someone needs it.
 */
export async function verifyJwtHmac(token: string, secret: string): Promise<JwtVerification> {
  const [header = '', payload = '', signature = ''] = token.trim().split('.');
  let alg: unknown;
  try {
    alg = (JSON.parse(new TextDecoder().decode(base64ToBytesLoose(header))) as { alg?: unknown }).alg;
  } catch {
    return { status: 'unsupported', reason: 'The header is not JSON' };
  }
  const hash = typeof alg === 'string' ? HMAC_JWT[alg] : undefined;
  if (!hash) return { status: 'unsupported', reason: `Only HS256, HS384 and HS512 can be checked here (this token uses ${String(alg)})` };
  const key = new TextEncoder().encode(secret);
  const expected = bytesToBase64(await hmac(hash, key, new TextEncoder().encode(`${header}.${payload}`)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return { status: expected === signature ? 'valid' : 'invalid' };
}
