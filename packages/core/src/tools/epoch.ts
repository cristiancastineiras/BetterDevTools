export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

export interface Instant {
  /** Milliseconds since the Unix epoch (fractions kept for µs/ns input). */
  ms: number;
  /** How the input was read: a count of seconds, milliseconds…, or a date text. */
  unit: EpochUnit | 'date';
}

const DIVISORS: Record<EpochUnit, number> = { s: 0.001, ms: 1, us: 1000, ns: 1_000_000 };

/** The unit of a bare number by its size: 10 digits are seconds, 13 milliseconds, 16 microseconds, 19 nanoseconds. */
export function guessUnit(digits: number): EpochUnit {
  return digits <= 11 ? 's' : digits <= 14 ? 'ms' : digits <= 17 ? 'us' : 'ns';
}

/** Reads a timestamp or a date text (ISO 8601, RFC 2822, "now"); null when it is neither. */
export function parseInstant(input: string, now = Date.now(), unit?: EpochUnit): Instant | null {
  const text = input.trim();
  if (!text) return null;
  if (text.toLowerCase() === 'now') return { ms: now, unit: 'date' };
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const u = unit ?? guessUnit(text.replace(/^-|\..*$/g, '').length);
    return { ms: Number(text) / DIVISORS[u], unit: u };
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : { ms, unit: 'date' };
}

export interface ZoneView {
  zone: string;
  /** YYYY-MM-DD HH:mm:ss.SSS in that zone. */
  text: string;
  /** +02:00 style offset. */
  offset: string;
}

export function inZone(ms: number, zone: string): ZoneView {
  const date = new Date(ms);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  const millis = String(((Math.floor(ms) % 1000) + 1000) % 1000).padStart(3, '0');
  return { zone, text: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${millis}`, offset };
}

const STEPS: [number, string][] = [
  [1000, 'second'],
  [60, 'minute'],
  [60, 'hour'],
  [24, 'day'],
  [30, 'month'],
  [12, 'year'],
];

/** "3 hours ago", "in 2 days": the largest unit that fits. */
export function relativeTime(ms: number, now: number, locale = 'en'): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = (ms - now) / 1000;
  let unit = 'second';
  for (const [size, name] of STEPS.slice(1)) {
    if (Math.abs(value) < size) break;
    value /= size;
    unit = name;
  }
  return formatter.format(Math.trunc(value), unit as Intl.RelativeTimeFormatUnit);
}

export function epochRows(ms: number): Record<EpochUnit, string> {
  return {
    s: String(Math.floor(ms / 1000)),
    ms: String(Math.floor(ms)),
    us: String(Math.round(ms * 1000)),
    ns: String(BigInt(Math.round(ms * 1000)) * 1000n),
  };
}
