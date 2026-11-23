// Cron expressions: 5 fields (minute hour day-of-month month day-of-week), an optional leading
// seconds field, the @macros, names, lists, ranges and steps. Day-of-month and day-of-week
// together mean "either", as in Vixie cron.

export class CronError extends Error {}

interface FieldDef {
  name: string;
  min: number;
  max: number;
  names?: string[];
}
interface Field {
  values: number[];
  /** True for `*` and `?`: every value, no restriction. */
  star: boolean;
  /** n when the whole field is a single step over everything (every n-th value). */
  step: number | undefined;
}
export interface CronSpec {
  seconds: Field | undefined;
  minutes: Field;
  hours: Field;
  days: Field;
  months: Field;
  weekdays: Field;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DEFS = {
  seconds: { name: 'second', min: 0, max: 59 },
  minutes: { name: 'minute', min: 0, max: 59 },
  hours: { name: 'hour', min: 0, max: 23 },
  days: { name: 'day of month', min: 1, max: 31 },
  months: { name: 'month', min: 1, max: 12, names: MONTHS },
  weekdays: { name: 'day of week', min: 0, max: 7, names: WEEKDAYS },
} satisfies Record<string, FieldDef>;

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function parseField(text: string, def: FieldDef): Field {
  const number = (token: string): number => {
    const named = def.names ? def.names.indexOf(token.toUpperCase()) : -1;
    const value = named >= 0 ? named + (def.name === 'month' ? 1 : 0) : /^\d+$/.test(token) ? Number(token) : Number.NaN;
    if (Number.isNaN(value) || value < def.min || value > def.max)
      throw new CronError(`"${token}" is not valid for ${def.name} (${def.min}-${def.max})`);
    return value;
  };
  const values = new Set<number>();
  for (const item of text.split(',')) {
    const [range = '', stepText] = item.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`The step "${stepText}" in ${def.name} must be a positive whole number`);
    let from: number;
    let to: number;
    if (range === '*' || range === '?') [from, to] = [def.min, def.name === 'day of week' ? 6 : def.max];
    else if (range.includes('-')) {
      const [a = '', b = ''] = range.split('-');
      [from, to] = [number(a), number(b)];
      if (from > to) throw new CronError(`The range ${range} in ${def.name} runs backwards`);
    } else {
      from = number(range);
      to = stepText === undefined ? from : def.max;
    }
    for (let v = from; v <= to; v += step) values.add(def.name === 'day of week' && v === 7 ? 0 : v);
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const full = def.max - def.min + 1 - (def.name === 'day of week' ? 1 : 0);
  return {
    values: sorted,
    star: text === '*' || text === '?',
    step: /^\*\/\d+$/.test(text) && sorted.length < full ? Number(text.slice(2)) : undefined,
  };
}

export function parseCron(expression: string): CronSpec {
  const text = MACROS[expression.trim().toLowerCase()] ?? expression.trim();
  if (text.startsWith('@'))
    throw new CronError(`"${text}" cannot be scheduled: only @yearly, @monthly, @weekly, @daily and @hourly are known`);
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) throw new CronError(`Expected 5 fields (or 6 with seconds), found ${parts.length}`);
  const [seconds, ...rest] = parts.length === 6 ? parts : [undefined, ...parts];
  const [m = '', h = '', d = '', mo = '', w = ''] = rest;
  return {
    seconds: seconds === undefined ? undefined : parseField(seconds, DEFS.seconds),
    minutes: parseField(m, DEFS.minutes),
    hours: parseField(h, DEFS.hours),
    days: parseField(d, DEFS.days),
    months: parseField(mo, DEFS.months),
    weekdays: parseField(w, DEFS.weekdays),
  };
}

/** The next `count` moments the expression fires after `after`, in local time or UTC. Fewer when it never does (Feb 30). */
export function nextRuns(spec: CronSpec, after: Date, count: number, utc = false): Date[] {
  const part = (d: Date) =>
    utc
      ? {
          y: d.getUTCFullYear(),
          mo: d.getUTCMonth() + 1,
          d: d.getUTCDate(),
          h: d.getUTCHours(),
          mi: d.getUTCMinutes(),
          s: d.getUTCSeconds(),
          w: d.getUTCDay(),
        }
      : { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), w: d.getDay() };
  const make = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
    utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  const dayMatches = (p: ReturnType<typeof part>) => {
    const byDay = spec.days.values.includes(p.d);
    const byWeekday = spec.weekdays.values.includes(p.w);
    if (spec.days.star && spec.weekdays.star) return true;
    if (spec.days.star) return byWeekday;
    if (spec.weekdays.star) return byDay;
    return byDay || byWeekday;
  };
  const first = part(after);
  let t = make(first.y, first.mo, first.d, first.h, first.mi, first.s + (spec.seconds ? 1 : 0));
  if (!spec.seconds) t = make(first.y, first.mo, first.d, first.h, first.mi + 1, 0);
  const out: Date[] = [];
  const lastYear = first.y + 8;
  while (out.length < count) {
    const p = part(t);
    if (p.y > lastYear) break;
    if (!spec.months.values.includes(p.mo)) t = make(p.y, p.mo + 1, 1, 0, 0, 0);
    else if (!dayMatches(p)) t = make(p.y, p.mo, p.d + 1, 0, 0, 0);
    else if (!spec.hours.values.includes(p.h)) t = make(p.y, p.mo, p.d, p.h + 1, 0, 0);
    else if (!spec.minutes.values.includes(p.mi)) t = make(p.y, p.mo, p.d, p.h, p.mi + 1, 0);
    else if (spec.seconds && !spec.seconds.values.includes(p.s)) t = make(p.y, p.mo, p.d, p.h, p.mi, p.s + 1);
    else {
      out.push(t);
      t = spec.seconds ? make(p.y, p.mo, p.d, p.h, p.mi, p.s + 1) : make(p.y, p.mo, p.d, p.h, p.mi + 1, 0);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ describing

const PHRASES = {
  en: {
    every: (unit: string) => `Every ${unit}`,
    everyN: (n: number, unit: string) => `Every ${n} ${unit}s`,
    at: (time: string) => `At ${time}`,
    atMinutes: (list: string, many: boolean, hours: string) => `At minute${many ? 's' : ''} ${list} past ${hours}`,
    everyMinutePast: (hours: string) => `Every minute past ${hours}`,
    everyHour: 'every hour',
    hours: (list: string, many: boolean) => `hour${many ? 's' : ''} ${list}`,
    everyNthHour: (n: number) => `every ${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} hour`,
    day: (list: string, many: boolean) => `on day${many ? 's' : ''}-of-month ${list}`,
    month: (list: string) => `in ${list}`,
    weekday: (list: string) => `on ${list}`,
    and: 'and',
    range: (a: string, b: string) => `${a} through ${b}`,
    seconds: (list: string) => `at second ${list}`,
    never: 'Never fires',
  },
  es: {
    every: (unit: string) => `Cada ${unit}`,
    everyN: (n: number, unit: string) => `Cada ${n} ${unit === 'minute' ? 'minutos' : unit === 'hour' ? 'horas' : unit}`,
    at: (time: string) => `A las ${time}`,
    atMinutes: (list: string, many: boolean, hours: string) => `En ${many ? 'los minutos' : 'el minuto'} ${list} de ${hours}`,
    everyMinutePast: (hours: string) => `Cada minuto de ${hours}`,
    everyHour: 'cada hora',
    hours: (list: string, many: boolean) => `${many ? 'las horas' : 'la hora'} ${list}`,
    everyNthHour: (n: number) => `cada ${n} horas`,
    day: (list: string, many: boolean) => `${many ? 'los días' : 'el día'} ${list} del mes`,
    month: (list: string) => `en ${list}`,
    weekday: (list: string) => `de ${list}`,
    and: 'y',
    range: (a: string, b: string) => `${a} a ${b}`,
    seconds: (list: string) => `en el segundo ${list}`,
    never: 'No se ejecuta nunca',
  },
};

const UNIT_NAMES = { en: { minute: 'minute', hour: 'hour', second: 'second' }, es: { minute: 'minuto', hour: 'hora', second: 'segundo' } };

const plain = (v: number) => String(v);
const named = (names: string[], base: number) => (v: number) => names[v - base] ?? String(v);
const two = (v: number) => String(v).padStart(2, '0');

/** English or Spanish text for an expression, in the style of crontab.guru. */
export function describeCron(spec: CronSpec, lang: 'en' | 'es' = 'en'): string {
  const p = PHRASES[lang];
  const list = (items: string[]) => new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
  /** Runs of three or more consecutive values become "a through b". */
  const compress = (values: number[], label: (v: number) => string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < values.length;) {
      let j = i;
      while (j + 1 < values.length && values[j + 1] === values[j]! + 1) j++;
      if (j - i >= 2) out.push(p.range(label(values[i]!), label(values[j]!)));
      else for (let k = i; k <= j; k++) out.push(label(values[k]!));
      i = j + 1;
    }
    return out;
  };
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' });
  const weekdayNames = Array.from({ length: 7 }, (_, i) => weekday.format(new Date(Date.UTC(2023, 0, 1 + i))));
  const monthNames = Array.from({ length: 12 }, (_, i) => month.format(new Date(Date.UTC(2023, i, 1))));

  const { minutes: m, hours: h } = spec;
  if (!m.values.length || !h.values.length) return p.never;
  const hoursText = h.star ? p.everyHour : h.step ? p.everyNthHour(h.step) : p.hours(list(compress(h.values, plain)), h.values.length > 1);
  let time: string;
  if (m.values.length === 1 && h.values.length === 1) time = p.at(`${two(h.values[0]!)}:${two(m.values[0]!)}`);
  else if (m.star && h.star) time = p.every(UNIT_NAMES[lang].minute);
  else if (m.step && h.star) time = p.everyN(m.step, 'minute');
  else if (m.star) time = p.everyMinutePast(hoursText);
  else time = p.atMinutes(list(compress(m.values, plain)), m.values.length > 1, hoursText);
  if (spec.seconds && !spec.seconds.star) time += ` ${p.seconds(list(compress(spec.seconds.values, plain)))}`;

  const days = spec.days.star ? '' : p.day(list(compress(spec.days.values, plain)), spec.days.values.length > 1);
  const months = spec.months.star ? '' : p.month(list(compress(spec.months.values, named(monthNames, 1))));
  const weekdays = spec.weekdays.star ? '' : p.weekday(list(compress(spec.weekdays.values, named(weekdayNames, 0))));
  return [time, days, months, days && weekdays ? `${p.and} ${weekdays}` : weekdays]
    .filter(Boolean)
    .join(', ')
    .replace(/, (and|y) /, ' $1 ');
}
