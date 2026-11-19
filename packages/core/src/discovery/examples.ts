// What may be kept of a real response: examples are cut down and scrubbed of credentials and
// personal data BEFORE they are stored or exported. Schemas carry no values (only the few
// enum candidates, which skip personal fields); examples are the only place values survive.

export const SECRET_KEY =
  /(pass(word|wd|phrase)?|secret|token|api[-_]?key|apikey|authorization|auth|cookie|session|credential|private|signature|otp|cvv|cvc|pin|bearer|jwt)/i;

const PERSONAL_KEY =
  /^(e-?mail|email_?address|phone|phone_?number|mobile|tel|telephone|address|street|street_?address|zip|zip_?code|postal_?code|first_?name|last_?name|sur_?name|full_?name|given_?name|family_?name|display_?name|user_?name|nick_?name|birth(day|_?date)?|dob|dni|nif|nie|ssn|iban|passport|salary|latitude|longitude|lat|lng|lon|ip|ip_?address)$/i;

/** Keys that mean a person is described here, which makes a plain `name` personal too. */
const PERSON_HINT = /^(e-?mail|phone|mobile|first_?name|last_?name|sur_?name|birth|dob|dni|ssn)/i;

export const MASK = {
  secret: '[REDACTED]',
  personal: '[personal data]',
  email: '[email]',
  jwt: '[jwt]',
  token: '[token]',
  card: '[card]',
  ip: '[ip]',
};

const LIMITS = { depth: 6, items: 3, keys: 30, stringChars: 120, exampleChars: 2000 };

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Scrubs a string value: tokens, emails, card numbers and IPs are replaced, long text is cut. */
export function scrubString(text: string): string {
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(text)) return MASK.jwt;
  if (/^(Bearer|Basic|Token)\s+\S+/i.test(text)) return `${text.split(/\s+/)[0]} ${MASK.secret}`;
  if (/^[A-Za-z0-9+/_=-]{32,}$/.test(text) && /\d/.test(text) && /[A-Za-z]/.test(text)) return MASK.token;
  const digits = text.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return MASK.card;
  let result = text.replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, MASK.email).replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, MASK.ip);
  if (result.length > LIMITS.stringChars) result = `${result.slice(0, LIMITS.stringChars)}…`;
  return result;
}

/** A trimmed, scrubbed copy of a value, safe to keep as an example. */
export function sanitizeValue(value: unknown, key = '', depth = 0, personNearby = false): unknown {
  if (key && SECRET_KEY.test(key)) return MASK.secret;
  if (key && (PERSONAL_KEY.test(key) || (personNearby && /^(name|title)$/i.test(key)))) {
    return typeof value === 'string'
      ? MASK.personal
      : typeof value === 'number'
        ? 0
        : typeof value === 'object' && value !== null
          ? '…'
          : value;
  }
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= LIMITS.depth) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, LIMITS.items).map((item) => sanitizeValue(item, '', depth + 1));
    return value.length > LIMITS.items ? [...items, `… ${value.length - LIMITS.items} more`] : items;
  }
  const entries = Object.entries(value);
  const hint = entries.some(([name]) => PERSON_HINT.test(name));
  const kept = entries.slice(0, LIMITS.keys).map(([name, child]) => [name, sanitizeValue(child, name, depth + 1, hint)]);
  if (entries.length > LIMITS.keys) kept.push(['…', `${entries.length - LIMITS.keys} more keys`]);
  return Object.fromEntries(kept);
}

/** Pretty JSON of a scrubbed value, cut at a size that keeps a saved session small. */
export function exampleText(value: unknown): string {
  const text = JSON.stringify(sanitizeValue(value), null, 2) ?? '';
  return text.length > LIMITS.exampleChars ? `${text.slice(0, LIMITS.exampleChars)}\n…` : text;
}

/** A query or form value as an example. */
export function exampleParam(name: string, value: string): string {
  return SECRET_KEY.test(name) ? MASK.secret : PERSONAL_KEY.test(name) ? MASK.personal : scrubString(value);
}

/** A URL as an example: no credentials, no fragment, secret and personal query values and emails masked. */
export function exampleUrl(url: string): string {
  const parsed = URL.parse(url);
  if (!parsed) return scrubString(url);
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  for (const [name, value] of Array.from(parsed.searchParams)) parsed.searchParams.set(name, exampleParam(name, value));
  parsed.pathname = parsed.pathname
    .split('/')
    .map((segment) => {
      const text = decodeURIComponent(segment.replace(/%(?![0-9a-f]{2})/gi, '%25'));
      return /@/.test(text) ? MASK.email : /^[A-Za-z0-9+/_=-]{32,}$/.test(text) && /\d/.test(text) ? MASK.token : segment;
    })
    .join('/');
  // the masks are readable text, not percent-encoded
  return parsed.href.replace(
    /%5B(REDACTED|personal(?:%20|\+)data|email|jwt|token|card|ip)%5D/g,
    (_all, name: string) => `[${name.replace(/%20|\+/, ' ')}]`,
  );
}
