// Incremental JSON Schema inference. Every sample is folded into a small plain-object
// accumulator (so a million samples cost the same as ten, and a session can be saved as JSON);
// the accumulator turns into a JSON Schema on demand. What is inferred is a description of what
// was observed, never a contract: a field missing from the samples is "not always seen", which does
// not prove it is optional, and the schema says so (`x-inferred`).

export type JsonType = 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object';

export interface SchemaAcc {
  /** Values observed here (for a property: the times it was present). */
  n: number;
  types: Partial<Record<JsonType, number>>;
  str?: StringStats;
  arr?: { items: SchemaAcc; minLen: number; maxLen: number };
  obj?: { props: Record<string, SchemaAcc>; count: number; capped: boolean };
}

interface StringStats {
  formats: Record<string, number>;
  /** Value counts while there are few distinct values, `null` once there are too many. */
  values: Record<string, number> | null;
}

import { SECRET_KEY } from './examples.ts';

export const SCHEMA_LIMITS = { depth: 12, arraySamples: 50, props: 300, enumValues: 12, enumLength: 40, minEnumSamples: 5 };

export const emptySchemaAcc = (): SchemaAcc => ({ n: 0, types: {} });

const FORMATS: [string, RegExp][] = [
  ['date-time', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^https?:\/\/[^\s]+$/],
  ['ipv4', /^(?:\d{1,3}\.){3}\d{1,3}$/],
];

function formatOf(text: string): string | null {
  if (text.length > 100 || text.length < 6) return null;
  for (const [name, pattern] of FORMATS) if (pattern.test(text)) return name;
  return null;
}

/** Field names whose values are personal or credentials: never remembered, so never enum candidates.*/
const PERSONAL_NAME =
  /(e-?mail|phone|mobile|tel|address|street|city|zip|postal|name|surname|birth|dni|nif|ssn|iban|card|passport|password|salary|ip|lat|lng|lon|user|login|owner|author|customer|client|account|contact)/i;

const ENUM_BLOCK = /@|^\+?\d[\d\s-]{6,}$|^[A-Za-z0-9+/_-]{24,}$|\d{4,}/;

const enumSafe = (name: string, value: string) =>
  value.length <= SCHEMA_LIMITS.enumLength && !PERSONAL_NAME.test(name) && !SECRET_KEY.test(name) && !ENUM_BLOCK.test(value);

const bump = (types: SchemaAcc['types'], type: JsonType) => {
  types[type] = (types[type] ?? 0) + 1;
};

/**
 * Folds one value into the accumulator. `name` is the property the value sits in: values of
 * personal or credential-like fields are never remembered (not even as enum candidates), so the
 * accumulator, which is saved with the session, holds structure and nothing else.
 */
export function observeValue(acc: SchemaAcc, value: unknown, depth = 0, name = ''): void {
  acc.n++;
  if (value === null || value === undefined) return bump(acc.types, 'null');
  switch (typeof value) {
    case 'boolean':
      return bump(acc.types, 'boolean');
    case 'number':
      return bump(acc.types, Number.isInteger(value) ? 'integer' : 'number');
    case 'string': {
      bump(acc.types, 'string');
      const stats = (acc.str ??= { formats: {}, values: {} });
      const format = formatOf(value);
      if (format) stats.formats[format] = (stats.formats[format] ?? 0) + 1;
      if (stats.values) {
        if (!enumSafe(name, value) || (!(value in stats.values) && Object.keys(stats.values).length >= SCHEMA_LIMITS.enumValues)) stats.values = null;
        else stats.values[value] = (stats.values[value] ?? 0) + 1;
      }
      return;
    }
    case 'object':
      break;
    default:
      return bump(acc.types, 'null'); // bigint, symbol, function: not JSON
  }
  if (depth >= SCHEMA_LIMITS.depth) return bump(acc.types, Array.isArray(value) ? 'array' : 'object');
  if (Array.isArray(value)) {
    bump(acc.types, 'array');
    const arr = (acc.arr ??= { items: emptySchemaAcc(), minLen: value.length, maxLen: value.length });
    arr.minLen = Math.min(arr.minLen, value.length);
    arr.maxLen = Math.max(arr.maxLen, value.length);
    const sampled = Math.min(value.length, SCHEMA_LIMITS.arraySamples);
    for (let index = 0; index < sampled; index++) observeValue(arr.items, value[index], depth + 1, name);
    return;
  }
  bump(acc.types, 'object');
  const obj = (acc.obj ??= { props: {}, count: 0, capped: false });
  obj.count++;
  for (const key of Object.keys(value)) {
    let prop = obj.props[key];
    if (!prop) {
      if (Object.keys(obj.props).length >= SCHEMA_LIMITS.props) {
        obj.capped = true;
        continue;
      }
      prop = obj.props[key] = emptySchemaAcc();
    }
    observeValue(prop, (value as Record<string, unknown>)[key], depth + 1, key);
  }
}

/** Folds accumulator `b` into `a` (used when two endpoints turn out to be one). */
export function mergeSchemaAcc(a: SchemaAcc, b: SchemaAcc): SchemaAcc {
  a.n += b.n;
  for (const [type, count] of Object.entries(b.types) as [JsonType, number][]) a.types[type] = (a.types[type] ?? 0) + count;
  if (b.str) {
    const mine = (a.str ??= { formats: {}, values: {} });
    for (const [format, count] of Object.entries(b.str.formats)) mine.formats[format] = (mine.formats[format] ?? 0) + count;
    if (mine.values && b.str.values) {
      for (const [value, count] of Object.entries(b.str.values)) mine.values[value] = (mine.values[value] ?? 0) + count;
      if (Object.keys(mine.values).length > SCHEMA_LIMITS.enumValues) mine.values = null;
    } else mine.values = null;
  }
  if (b.arr) {
    if (a.arr) {
      a.arr.minLen = Math.min(a.arr.minLen, b.arr.minLen);
      a.arr.maxLen = Math.max(a.arr.maxLen, b.arr.maxLen);
      mergeSchemaAcc(a.arr.items, b.arr.items);
    } else a.arr = structuredClone(b.arr);
  }
  if (b.obj) {
    if (a.obj) {
      a.obj.count += b.obj.count;
      a.obj.capped ||= b.obj.capped;
      for (const [key, prop] of Object.entries(b.obj.props)) {
        const mine = a.obj.props[key];
        if (mine) mergeSchemaAcc(mine, prop);
        else if (Object.keys(a.obj.props).length < SCHEMA_LIMITS.props) a.obj.props[key] = structuredClone(prop);
        else a.obj.capped = true;
      }
    } else a.obj = structuredClone(b.obj);
  }
  return a;
}

// ------------------------------------------------------------------------------ JSON Schema

export type JsonSchema = { [key: string]: unknown };


function nonNullTypes(acc: SchemaAcc): JsonType[] {
  const present = (Object.keys(acc.types) as JsonType[]).filter((type) => type !== 'null');
  // integers and other numbers are one JSON "number" when both were seen
  return present.includes('integer') && present.includes('number') ? present.filter((type) => type !== 'integer') : present;
}

function scalarSchema(type: JsonType, acc: SchemaAcc, name: string): JsonSchema {
  const schema: JsonSchema = { type };
  if (type !== 'string' || !acc.str) return schema;
  const total = acc.types.string ?? 0;
  const [format, count] = Object.entries(acc.str.formats).sort((x, y) => y[1] - x[1])[0] ?? [];
  if (format && count! >= total * 0.95) schema.format = format;
  const values = acc.str.values;
  if (values && !schema.format && !PERSONAL_NAME.test(name)) {
    const entries = Object.entries(values);
    // a candidate only when the same few values keep coming back
    if (total >= SCHEMA_LIMITS.minEnumSamples && entries.length > 1 && entries.length <= SCHEMA_LIMITS.enumValues && entries.every(([value, c]) => c >= 2 && !ENUM_BLOCK.test(value))) {
      schema.enum = entries.map(([value]) => value).sort();
      schema['x-enum-candidate'] = true;
    }
  }
  return schema;
}

const looksLikeId = (key: string) => segmentLike(key);
const segmentLike = (key: string) => /^\d+$/.test(key) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(key) || /^[0-9a-f]{24}$/i.test(key);

/** The schema for one accumulator; `name` is the property name (for the enum safeguards). */
export function toJsonSchema(acc: SchemaAcc, name = ''): JsonSchema {
  const types = nonNullTypes(acc);
  const nullable = (acc.types.null ?? 0) > 0;
  if (!types.length) return nullable ? { type: 'null' } : {};

  const parts = types.map((type): JsonSchema => {
    if (type === 'object' && acc.obj) return objectSchema(acc);
    if (type === 'array' && acc.arr) {
      const items = acc.arr.items.n ? toJsonSchema(acc.arr.items, name) : {};
      return { type: 'array', items };
    }
    return scalarSchema(type, acc, name);
  });

  if (parts.length === 1) {
    const [only] = parts as [JsonSchema];
    return nullable ? { ...only, type: [only.type as string, 'null'] } : only;
  }
  // several kinds of value in one place: say so, and keep each kind's own schema
  return { anyOf: [...parts, ...(nullable ? [{ type: 'null' }] : [])], 'x-inconsistent-types': true };
}

function objectSchema(acc: SchemaAcc): JsonSchema {
  const { props, count } = acc.obj!;
  const keys = Object.keys(props);
  // a map keyed by ids (a dictionary), not an object with a fixed set of fields
  if (keys.length >= 8 && keys.filter(looksLikeId).length >= keys.length * 0.8) {
    const merged = emptySchemaAcc();
    for (const prop of Object.values(props)) mergeSchemaAcc(merged, structuredClone(prop));
    return { type: 'object', additionalProperties: toJsonSchema(merged) };
  }
  const properties: Record<string, JsonSchema> = {};
  for (const key of keys) properties[key] = toJsonSchema(props[key]!, key);
  const required = keys.filter((key) => props[key]!.n === count && count > 0);
  return { type: 'object', properties, ...(required.length ? { required } : {}), ...(acc.obj!.capped ? { 'x-properties-truncated': true } : {}) };
}

/** The schema of a whole body: the inferred schema with a note of what it was inferred from. */
export function inferSchema(acc: SchemaAcc): JsonSchema {
  return { ...toJsonSchema(acc), 'x-inferred': true, 'x-samples': acc.n };
}

/** Removes the annotations that describe the inference, to compare or hash structures. */
export function canonicalSchema(schema: JsonSchema): JsonSchema {
  const copy: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'x-samples' || key === 'x-inferred') continue;
    copy[key] = Array.isArray(value)
      ? value.map((item) => (typeof item === 'object' && item ? canonicalSchema(item as JsonSchema) : item))
      : typeof value === 'object' && value
        ? key === 'properties'
          ? Object.fromEntries(Object.entries(value as Record<string, JsonSchema>).map(([name, child]) => [name, canonicalSchema(child)]))
          : canonicalSchema(value as JsonSchema)
        : value;
  }
  return copy;
}

/** A string that is equal for structurally equal schemas (property order does not matter). */
export function schemaFingerprint(schema: JsonSchema): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : typeof value === 'object' && value
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, child]) => [key, key === 'required' || key === 'enum' ? (child as string[]).toSorted() : sort(child)]),
          )
        : value;
  return JSON.stringify(sort(canonicalSchema(schema)));
}

/** What the observations say is uneven about a body: conflicting types, missing and null fields. */
export interface SchemaFinding {
  path: string;
  kind: 'type-conflict' | 'sometimes-missing' | 'nullable';
  detail: string;
}

export function schemaFindings(acc: SchemaAcc, path = '$', out: SchemaFinding[] = [], depth = 0): SchemaFinding[] {
  if (depth > SCHEMA_LIMITS.depth || out.length >= 200) return out;
  const types = nonNullTypes(acc);
  if (types.length > 1) out.push({ path, kind: 'type-conflict', detail: types.map((type) => `${type} ×${acc.types[type]}`).join(', ') });
  if (acc.arr?.items.n) schemaFindings(acc.arr.items, `${path}[]`, out, depth + 1);
  if (acc.obj) {
    for (const [key, prop] of Object.entries(acc.obj.props)) {
      const at = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      if (prop.n < acc.obj.count) out.push({ path: at, kind: 'sometimes-missing', detail: `${prop.n}/${acc.obj.count}` });
      if ((prop.types.null ?? 0) > 0 && (prop.types.null ?? 0) < prop.n) out.push({ path: at, kind: 'nullable', detail: `${prop.types.null}/${prop.n}` });
      schemaFindings(prop, at, out, depth + 1);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------- validation

export interface SchemaIssue {
  path: string;
  message: string;
}

function typeOf(value: unknown): JsonType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value as JsonType;
}

const FORMAT_CHECKS = new Map(FORMATS);
const MAX_ISSUES = 50;

/** Checks a value against an inferred schema (the subset these schemas use). Never throws. */
export function validateSchema(schema: JsonSchema, value: unknown, path = '$', issues: SchemaIssue[] = [], depth = 0): SchemaIssue[] {
  if (issues.length >= MAX_ISSUES || depth > SCHEMA_LIMITS.depth + 2) return issues;
  const anyOf = schema.anyOf as JsonSchema[] | undefined;
  if (anyOf) {
    if (!anyOf.some((option) => validateSchema(option, value, path, [], depth + 1).length === 0)) {
      issues.push({ path, message: `expected ${anyOf.map((option) => String(option.type)).join(' | ')}, received ${typeOf(value)}` });
    }
    return issues;
  }
  const declared = schema.type as string | string[] | undefined;
  const allowed = declared === undefined ? null : Array.isArray(declared) ? declared : [declared];
  const actual = typeOf(value);
  if (allowed && !allowed.includes(actual) && !(actual === 'integer' && allowed.includes('number'))) {
    issues.push({ path, message: `expected ${allowed.join(' | ')}, received ${actual}` });
    return issues;
  }
  if (typeof value === 'string') {
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues && !enumValues.includes(value)) issues.push({ path, message: `value not among the observed ${enumValues.length} values` });
    const format = schema.format as string | undefined;
    if (format && !FORMAT_CHECKS.get(format)?.test(value)) issues.push({ path, message: `expected ${format}` });
  } else if (Array.isArray(value) && schema.items) {
    const sampled = Math.min(value.length, SCHEMA_LIMITS.arraySamples);
    for (let index = 0; index < sampled; index++) validateSchema(schema.items as JsonSchema, value[index], `${path}[]`, issues, depth + 1);
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, JsonSchema> | undefined;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in record)) issues.push({ path: `${path}.${key}`, message: 'required field missing' });
    }
    if (properties) {
      for (const [key, child] of Object.entries(properties)) if (key in record) validateSchema(child, record[key], `${path}.${key}`, issues, depth + 1);
    } else if (schema.additionalProperties) {
      for (const [key, child] of Object.entries(record).slice(0, SCHEMA_LIMITS.arraySamples)) validateSchema(schema.additionalProperties as JsonSchema, child, `${path}[${JSON.stringify(key)}]`, issues, depth + 1);
    }
  }
  return issues;
}
