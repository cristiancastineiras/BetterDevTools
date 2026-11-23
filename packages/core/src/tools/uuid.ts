const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export const uuidV4 = (): string => crypto.randomUUID();

let lastMs = 0;
let counter = 0;

/**
 * UUID version 7 (RFC 9562): 48 bits of Unix milliseconds, then random bits. Ids made in the
 * same millisecond count up in rand_a, so a batch sorts in the order it was made.
 */
export function uuidV7(
  now = Date.now(),
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (b) => crypto.getRandomValues(b),
): string {
  const ms = Math.max(now, lastMs);
  counter = ms === lastMs ? (counter + 1) & 0xfff : 0;
  if (ms === lastMs && counter === 0) return uuidV7(ms + 1, random); // 4096 ids in one millisecond: borrow the next one
  lastMs = ms;
  const bytes = random(new Uint8Array(16));
  const stamp = BigInt(ms);
  for (let i = 0; i < 6; i++) bytes[i] = Number((stamp >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  return dashed(hex(bytes));
}

export interface UuidInfo {
  valid: boolean;
  version?: number;
  variant?: string;
  /** Unix milliseconds, for the time-based versions 1, 6 and 7. */
  time?: number;
}

const GREGORIAN_OFFSET_MS = 12219292800000n; // 1582-10-15 to 1970-01-01

export function parseUuid(text: string): UuidInfo {
  const h = text
    .trim()
    .replace(/^urn:uuid:|^\{|\}$/gi, '')
    .replaceAll('-', '')
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return { valid: false };
  const version = Number.parseInt(h.charAt(12), 16);
  const nibble = Number.parseInt(h.charAt(16), 16);
  const variant = nibble < 8 ? 'NCS' : nibble < 12 ? 'RFC 9562' : nibble < 14 ? 'Microsoft' : 'reserved';
  let time: number | undefined;
  if (version === 7) time = Number(BigInt(`0x${h.slice(0, 12)}`));
  else if (version === 1 || version === 6) {
    const ticks =
      version === 1
        ? BigInt(`0x${h.slice(13, 16)}${h.slice(8, 12)}${h.slice(0, 8)}`)
        : BigInt(`0x${h.slice(0, 8)}${h.slice(8, 12)}${h.slice(13, 16)}`);
    time = Number(ticks / 10000n - GREGORIAN_OFFSET_MS);
  }
  return { valid: true, version, variant, ...(time === undefined ? {} : { time }) };
}

export function formatUuid(uuid: string, options: { upper: boolean; hyphens: boolean; braces: boolean }): string {
  let out = options.hyphens ? uuid : uuid.replaceAll('-', '');
  if (options.upper) out = out.toUpperCase();
  return options.braces ? `{${out}}` : out;
}
