// The API discovery model: fed one captured request at a time, it builds a map of the API
// (endpoints, parameters, inferred schemas, call dependencies, scenarios) without keeping the
// traffic. Everything it holds is plain JSON, so a session can be saved and reloaded, and nothing
// in it is a credential or a personal value: examples are scrubbed before they are stored.
import { bodyText } from '../format.ts';
import type { Body, Captured } from '../har.ts';
import { exampleParam, exampleText, exampleUrl } from './examples.ts';
import { normalizePath, paramName, shapeOf, type PathParam } from './normalize.ts';
import {
  inferSchema,
  mergeSchemaAcc,
  observeValue,
  schemaFingerprint,
  schemaFindings,
  validateSchema,
  emptySchemaAcc,
  type JsonSchema,
  type SchemaAcc,
  type SchemaFinding,
} from './schema.ts';

export const DISCOVERY_VERSION = 1;

/** Bodies bigger than this are not parsed (the endpoint is still counted, and flagged incomplete). */
export const MAX_PARSE_CHARS = 4_000_000;
const MAX_ENDPOINTS = 5_000;
const MAX_STATUS_KEYS = 8;
const MAX_EXAMPLES = 3;
const MAX_VIOLATIONS = 30;
const MAX_FLOW_VALUES = 20_000;
const TEMPORAL_WINDOW_MS = 2_000;
const MIN_COLLAPSE = 5;

export type EdgeKind = 'temporal' | 'data';

export interface QueryParam {
  count: number;
  types: Record<string, number>;
  examples: string[];
}

export interface Violation {
  status: string;
  path: string;
  message: string;
  count: number;
}

export interface Timing {
  n: number;
  sum: number;
  max: number;
  /** A sample of durations, for the 95th percentile. */
  samples: number[];
}

export interface EndpointStats {
  key: string;
  method: string;
  origin: string;
  template: string;
  /** GraphQL operation name, when the endpoint is one operation of a /graphql URL. */
  operation?: string | undefined;
  params: PathParam[];
  calls: number;
  firstSeen: number;
  lastSeen: number;
  statuses: Record<string, number>;
  urlExamples: string[];
  query: Record<string, QueryParam>;
  requestHeaders: Record<string, number>;
  responseHeaders: Record<string, number>;
  requestTypes: Record<string, number>;
  responseTypes: Record<string, number>;
  /** Authorization schemes seen (the credentials themselves are never read into the model). */
  auth: Record<string, number>;
  requestSchema?: SchemaAcc | undefined;
  /** Form fields of urlencoded bodies, by name. */
  formFields: Record<string, number>;
  /** One accumulator per response status (or class, past a few distinct codes). */
  responses: Record<string, SchemaAcc>;
  requestExample?: string | undefined;
  responseExamples: Record<string, string[]>;
  timing: Timing;
  size: { sum: number; max: number };
  incomplete: { unavailable: number; truncated: number; discarded: number; tooLarge: number; notJson: number };
  scenarios: Record<string, number>;
  /** Contract checks (Validation mode). */
  validation: { checked: number; failed: number; violations: Violation[] };
}

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  count: number;
  /** For data edges: where the value came from and where it went, e.g. `response $.token` → `header authorization`. */
  evidence: { source: string; target: string }[];
}

export interface Scenario {
  id: string;
  name: string;
  at: number;
  calls: number;
  /** Endpoints in the order they first appeared in this scenario. */
  endpoints: string[];
}

export interface FrozenContract {
  at: number;
  /** Schema per endpoint key and status. */
  schemas: Record<string, Record<string, JsonSchema>>;
}

export interface DiscoveryState {
  version: number;
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  /** Active recording time in ms (pauses excluded). */
  activeMs: number;
  mode: 'discovery' | 'validation';
  seen: number;
  ignored: number;
  endpoints: Record<string, EndpointStats>;
  edges: Record<string, Edge>;
  scenarios: Scenario[];
  frozen: FrozenContract | null;
  /** Endpoints first seen after the contract was frozen. */
  newSinceFreeze: string[];
}

export const newSessionId = () => crypto.randomUUID();

export function emptyState(name: string, now = Date.now()): DiscoveryState {
  return {
    version: DISCOVERY_VERSION,
    id: newSessionId(),
    name,
    startedAt: now,
    endedAt: null,
    activeMs: 0,
    mode: 'discovery',
    seen: 0,
    ignored: 0,
    endpoints: {},
    edges: {},
    scenarios: [],
    frozen: null,
    newSinceFreeze: [],
  };
}

// ----------------------------------------------------------------------------- selecting calls

/** Static assets and documents are not API calls. */
const NOT_API = /^(image|font|audio|video)\/|text\/(css|html)|javascript|wasm/i;
const API_TYPE = /json|xml|graphql|protobuf|msgpack|ndjson|event-stream|x-www-form-urlencoded/i;

export function isApiCall(call: Captured): boolean {
  if (!/^https?:\/\//i.test(call.url)) return false;
  const mime = call.mime.toLowerCase();
  if (API_TYPE.test(mime)) return true;
  if (NOT_API.test(mime)) return false;
  const type = call.type.toLowerCase();
  if (type === 'xhr' || type === 'fetch') return true;
  if (['script', 'stylesheet', 'image', 'font', 'document', 'media', 'manifest', 'other'].includes(type)) return false;
  return call.method !== 'GET' && call.method !== 'HEAD';
}

const jsonLike = (mime: string, text: string) => /json/i.test(mime) || /^\s*[{[]/.test(text);

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function graphqlOperation(text: string | undefined): { name: string; variables: unknown; query: string } | null {
  if (!text) return null;
  const parsed = parseJson(text);
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return null;
  const body = parsed.value as Record<string, unknown>;
  if (typeof body.query !== 'string') return null;
  const named = typeof body.operationName === 'string' && body.operationName ? body.operationName : /(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(body.query)?.[1];
  const field = /\{\s*([A-Za-z_]\w*)/.exec(body.query)?.[1];
  return { name: named ?? (field ? `anonymous:${field}` : 'anonymous'), variables: body.variables, query: body.query };
}

const statusKey = (status: number) => (status === 0 ? 'failed' : String(status));

function bump(record: Record<string, number>, key: string, by = 1) {
  record[key] = (record[key] ?? 0) + by;
}

function newEndpoint(key: string, method: string, origin: string, template: string, params: PathParam[], operation: string | undefined, now: number): EndpointStats {
  return {
    key,
    method,
    origin,
    template,
    operation,
    params,
    calls: 0,
    firstSeen: now,
    lastSeen: now,
    statuses: {},
    urlExamples: [],
    query: {},
    requestHeaders: {},
    responseHeaders: {},
    requestTypes: {},
    responseTypes: {},
    auth: {},
    formFields: {},
    responses: {},
    responseExamples: {},
    timing: { n: 0, sum: 0, max: 0, samples: [] },
    size: { sum: 0, max: 0 },
    incomplete: { unavailable: 0, truncated: 0, discarded: 0, tooLarge: 0, notJson: 0 },
    scenarios: {},
    validation: { checked: 0, failed: 0, violations: [] },
  };
}

// ---------------------------------------------------------------------------- value flow

interface FlowSource {
  key: string;
  path: string;
}

/** Leaf values worth following from a response into later requests: ids and tokens, not words or flags. */
function followable(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 100 && value <= Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'string') return false;
  if (value.length < 6 || value.length > 400 || /\s/.test(value)) return false;
  return /\d/.test(value) || value.length >= 16;
}

function walkLeaves(value: unknown, visit: (leaf: string | number, path: string) => void, path = '$', budget = { left: 400 }, depth = 0): void {
  if (budget.left <= 0 || depth > 8) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 20); index++) walkLeaves(value[index], visit, `${path}[]`, budget, depth + 1);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) walkLeaves(child, visit, /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`, budget, depth + 1);
  } else if (followable(value)) {
    budget.left--;
    visit(value, path);
  }
}

// ------------------------------------------------------------------------------- the model

export class DiscoveryModel {
  state: DiscoveryState;
  /** Value → where it was last produced. Memory only: values are never saved. */
  #flow = new Map<string, FlowSource>();
  #last: { key: string; started: number; scenario: string | null } | null = null;
  #scenario: string | null = null;
  /** Bumped on every change, for UIs that cache views of the model. */
  version = 0;

  constructor(state: DiscoveryState) {
    this.state = state;
    this.#scenario = state.scenarios.at(-1)?.id ?? null;
  }

  static create(name: string): DiscoveryModel {
    return new DiscoveryModel(emptyState(name));
  }

  /** A saved session; null when it is not one of ours or comes from a newer version. */
  static fromJSON(raw: unknown): DiscoveryModel | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const state = raw as Partial<DiscoveryState>;
    if (state.version !== DISCOVERY_VERSION || typeof state.id !== 'string' || typeof state.endpoints !== 'object' || !state.endpoints) return null;
    return new DiscoveryModel(state as DiscoveryState);
  }

  toJSON(): DiscoveryState {
    return this.state;
  }

  // -------------------------------------------------------------------------------- scenarios

  /** Starts a scenario (a named step of the user's navigation); later calls belong to it. */
  startScenario(name: string, at = Date.now()): Scenario {
    const scenario: Scenario = { id: `s${this.state.scenarios.length + 1}`, name, at, calls: 0, endpoints: [] };
    this.state.scenarios.push(scenario);
    this.#scenario = scenario.id;
    this.version++;
    return scenario;
  }

  // ---------------------------------------------------------------------------------- observe

  /** Folds one captured request (with its response body) into the model; false when it is not an API call. */
  observe(call: Captured, body: Body): boolean {
    const { state } = this;
    state.seen++;
    if (!isApiCall(call)) {
      state.ignored++;
      return false;
    }
    const url = URL.parse(call.url);
    if (!url) {
      state.ignored++;
      return false;
    }
    const request = call.har.request;
    const method = call.method.toUpperCase();
    const gql = method === 'POST' ? graphqlOperation(request.postData?.text) : null;
    const normalized = normalizePath(url.pathname);
    const key = `${method} ${url.origin}${normalized.template}${gql ? `#${gql.name}` : ''}`;

    let endpoint = state.endpoints[key];
    if (!endpoint) {
      if (Object.keys(state.endpoints).length >= MAX_ENDPOINTS) {
        state.ignored++;
        return false;
      }
      endpoint = state.endpoints[key] = newEndpoint(key, method, url.origin, normalized.template, normalized.params, gql?.name, call.started);
      if (state.frozen) state.newSinceFreeze.push(key);
    }
    endpoint.calls++;
    endpoint.lastSeen = Math.max(endpoint.lastSeen, call.started);
    endpoint.firstSeen = Math.min(endpoint.firstSeen, call.started);
    const status = statusKey(call.status);
    bump(endpoint.statuses, status);
    if (endpoint.urlExamples.length < MAX_EXAMPLES) {
      const example = exampleUrl(call.url);
      if (!endpoint.urlExamples.includes(example)) endpoint.urlExamples.push(example);
    }

    // query parameters
    for (const [name, value] of url.searchParams) {
      const param = (endpoint.query[name] ??= { count: 0, types: {}, examples: [] });
      param.count++;
      bump(param.types, /^-?\d+$/.test(value) ? 'integer' : /^(true|false)$/i.test(value) ? 'boolean' : 'string');
      if (param.examples.length < MAX_EXAMPLES) {
        const shown = exampleParam(name, value);
        if (!param.examples.includes(shown)) param.examples.push(shown);
      }
    }

    // headers: names only, plus the authorization scheme
    for (const header of request.headers) {
      const name = header.name.toLowerCase();
      if (name.startsWith(':')) continue;
      bump(endpoint.requestHeaders, name);
      if (name === 'authorization') bump(endpoint.auth, header.value.split(/\s+/)[0]?.toLowerCase() || 'unknown');
      else if (name === 'cookie') bump(endpoint.auth, 'cookie');
      else if (name === 'x-api-key') bump(endpoint.auth, 'api-key');
      if (name === 'content-type') bump(endpoint.requestTypes, header.value.split(';')[0]!.trim().toLowerCase());
    }
    for (const header of call.har.response.headers) {
      const name = header.name.toLowerCase();
      if (!name.startsWith(':')) bump(endpoint.responseHeaders, name);
    }
    const responseType = call.mime.split(';')[0]!.trim().toLowerCase();
    if (responseType) bump(endpoint.responseTypes, responseType);

    // request body
    let requestValue: unknown;
    const requestText = request.postData?.text;
    if (requestText) {
      if (gql) {
        requestValue = gql.variables;
        if (gql.variables !== undefined && gql.variables !== null) observeValue((endpoint.requestSchema ??= emptySchemaAcc()), gql.variables);
        endpoint.requestExample ??= exampleText({ query: gql.query.slice(0, 300), variables: gql.variables });
      } else if (/x-www-form-urlencoded/i.test(request.postData?.mimeType ?? '')) {
        for (const [name] of new URLSearchParams(requestText)) bump(endpoint.formFields, name);
      } else if (requestText.length <= MAX_PARSE_CHARS && jsonLike(request.postData?.mimeType ?? '', requestText)) {
        const parsed = parseJson(requestText);
        if (parsed.ok) {
          requestValue = parsed.value;
          observeValue((endpoint.requestSchema ??= emptySchemaAcc()), parsed.value);
          endpoint.requestExample ??= exampleText(parsed.value);
        }
      }
    }

    // response body
    let responseValue: unknown;
    const responseKey = Object.keys(endpoint.responses).length >= MAX_STATUS_KEYS && !(status in endpoint.responses) ? `${status[0]}XX` : status;
    if (body.state === 'unavailable') endpoint.incomplete.unavailable++;
    else if (body.state === 'discarded') endpoint.incomplete.discarded++;
    else if (body.state === 'truncated') endpoint.incomplete.truncated++;
    if (body.state === 'available' || body.state === 'empty') {
      const text = body.state === 'empty' ? '' : bodyText(body);
      if (text && jsonLike(call.mime, text)) {
        if (text.length > MAX_PARSE_CHARS) endpoint.incomplete.tooLarge++;
        else {
          const parsed = parseJson(text);
          if (parsed.ok) {
            responseValue = parsed.value;
            observeValue((endpoint.responses[responseKey] ??= emptySchemaAcc()), parsed.value);
            const examples = (endpoint.responseExamples[responseKey] ??= []);
            if (examples.length < 2) examples.push(exampleText(parsed.value));
          } else endpoint.incomplete.notJson++;
        }
      } else if (text) endpoint.incomplete.notJson++;
      else (endpoint.responses[responseKey] ??= emptySchemaAcc()).n++; // an empty body (204…) is an observation too
    }

    // timing and size
    const { timing } = endpoint;
    if (call.duration >= 0) {
      timing.n++;
      timing.sum += call.duration;
      timing.max = Math.max(timing.max, call.duration);
      if (timing.samples.length < 100) timing.samples.push(call.duration);
      else {
        // reservoir sampling: every duration is equally likely to be in the sample
        const slot = Math.floor(Math.random() * timing.n);
        if (slot < 100) timing.samples[slot] = call.duration;
      }
    }
    if (call.size > 0) {
      endpoint.size.sum += call.size;
      endpoint.size.max = Math.max(endpoint.size.max, call.size);
    }

    // scenario
    if (this.#scenario) {
      const scenario = state.scenarios.find((s) => s.id === this.#scenario);
      if (scenario) {
        scenario.calls++;
        if (!scenario.endpoints.includes(key) && scenario.endpoints.length < 200) scenario.endpoints.push(key);
        bump(endpoint.scenarios, scenario.id);
      }
    }

    // contract check
    if (state.frozen && responseValue !== undefined) this.#check(endpoint, responseKey, responseValue);

    // dependencies
    this.#dependencies(call, key, url, request.headers, requestValue, responseValue);

    this.version++;
    return true;
  }

  #check(endpoint: EndpointStats, status: string, value: unknown) {
    const contract = this.state.frozen?.schemas[endpoint.key];
    if (!contract) return;
    const schema = contract[status];
    const { validation } = endpoint;
    validation.checked++;
    if (!schema) {
      this.#violate(endpoint, status, '$', 'status not in the frozen contract');
      validation.failed++;
      return;
    }
    const issues = validateSchema(schema, value);
    if (issues.length) validation.failed++;
    for (const issue of issues) this.#violate(endpoint, status, issue.path, issue.message);
  }

  #violate(endpoint: EndpointStats, status: string, path: string, message: string) {
    const { violations } = endpoint.validation;
    const existing = violations.find((v) => v.status === status && v.path === path && v.message === message);
    if (existing) existing.count++;
    else if (violations.length < MAX_VIOLATIONS) violations.push({ status, path, message, count: 1 });
  }

  #dependencies(call: Captured, key: string, url: URL, headers: { name: string; value: string }[], requestValue: unknown, responseValue: unknown) {
    const edge = (from: string, to: string, kind: EdgeKind, evidence?: { source: string; target: string }) => {
      const id = `${kind}|${from}|${to}`;
      const found = (this.state.edges[id] ??= { from, to, kind, count: 0, evidence: [] });
      found.count++;
      if (evidence && found.evidence.length < 4 && !found.evidence.some((e) => e.source === evidence.source && e.target === evidence.target)) found.evidence.push(evidence);
    };

    // temporal: this call began soon after the previous one (same scenario)
    if (this.#last && this.#last.key !== key && this.#last.scenario === this.#scenario && call.started - this.#last.started >= 0 && call.started - this.#last.started <= TEMPORAL_WINDOW_MS) {
      edge(this.#last.key, key, 'temporal');
    }
    this.#last = { key, started: call.started, scenario: this.#scenario };

    // data: a value an earlier response produced shows up in this request
    const used = (value: string | number, target: string) => {
      const source = this.#flow.get(String(value));
      if (source && source.key !== key) edge(source.key, key, 'data', { source: source.path, target });
    };
    // in a URL a bare number is an id too (a response gives it as a number, the path as text)
    const idLike = (text: string) => /^\d{3,16}$/.test(text) || followable(text);
    url.pathname.split('/').forEach((segment) => segment && idLike(segment) && used(segment, 'path'));
    for (const [name, value] of url.searchParams) if (idLike(value)) used(value, `query ${name}`);
    for (const header of headers) {
      const name = header.name.toLowerCase();
      if (name === 'authorization' || name === 'x-api-key' || name === 'x-auth-token') {
        const credential = header.value.replace(/^\w+\s+/, '');
        if (followable(credential)) used(credential, `header ${name}`);
      }
    }
    if (requestValue !== undefined) walkLeaves(requestValue, (leaf, path) => used(leaf, `body ${path}`));

    // remember what this response produced (values stay in memory only)
    if (responseValue !== undefined) {
      walkLeaves(responseValue, (leaf, path) => {
        const text = String(leaf);
        if (!this.#flow.has(text) && this.#flow.size >= MAX_FLOW_VALUES) this.#flow.delete(this.#flow.keys().next().value!);
        this.#flow.set(text, { key, path });
      });
    }
  }

  // ----------------------------------------------------------------------------- consolidation

  /**
   * Second pass over the endpoints: where one path position takes many different literal values
   * and the responses have the same shape, it is one endpoint with a parameter. Needs evidence
   * (at least 5 distinct values, matching response shapes), so look-alike routes stay apart.
   */
  consolidate(): number {
    const { endpoints } = this.state;
    const alias = new Map<string, string>();
    let merged = 0;
    for (let round = 0; round < 3; round++) {
      const groups = new Map<string, { position: number; members: EndpointStats[] }>();
      for (const endpoint of Object.values(endpoints)) {
        const segments = endpoint.template.split('/').slice(1);
        segments.forEach((segment, position) => {
          if (segment.startsWith('{')) return;
          const rest = segments.map((other, index) => (index === position ? '*' : other.startsWith('{') ? '{}' : other)).join('/');
          const groupKey = `${endpoint.method}|${endpoint.origin}|${endpoint.operation ?? ''}|${rest}|${position}`;
          const group = groups.get(groupKey) ?? { position, members: [] };
          group.members.push(endpoint);
          groups.set(groupKey, group);
        });
      }
      let changed = false;
      for (const { position, members } of groups.values()) {
        if (members.length < MIN_COLLAPSE || members.some((member) => !endpoints[member.key])) continue;
        const shapes = members.map(successShape);
        const known = shapes.filter((shape) => shape !== null);
        const common = mostCommon(known);
        if (known.length < MIN_COLLAPSE || common.count < known.length * 0.8) continue;
        const keep = members.filter((_member, index) => shapes[index] === common.value || shapes[index] === null);
        if (keep.length < MIN_COLLAPSE) continue;
        merged += this.#collapse(keep, position, alias);
        changed = true;
      }
      if (!changed) break;
    }
    if (alias.size) this.#remap(alias);
    if (merged) this.version++;
    return merged;
  }

  #collapse(members: EndpointStats[], position: number, alias: Map<string, string>): number {
    const first = members[0]!;
    const segments = first.template.split('/').slice(1);
    const taken = new Set(segments.filter((s) => s.startsWith('{')).map((s) => s.slice(1, -1)));
    let name = paramName(segments[position - 1], 'slug');
    for (let n = 2; taken.has(name); n++) name = `${paramName(segments[position - 1], 'slug')}${n}`;
    const examples = members.map((member) => member.template.split('/')[position + 1]!).slice(0, 3);
    segments[position] = `{${name}}`;
    const template = `/${segments.join('/')}`;
    const key = `${first.method} ${first.origin}${template}${first.operation ? `#${first.operation}` : ''}`;
    const target = this.state.endpoints[key] ?? newEndpoint(key, first.method, first.origin, template, [], first.operation, first.firstSeen);
    // path parameters keep their order along the path
    const parameterAt = (index: number) => ({ name, kind: 'slug' as const, example: examples[index] ?? '' });
    target.params = [...target.params, parameterAt(0)].sort((a, b) => template.indexOf(`{${a.name}}`) - template.indexOf(`{${b.name}}`));
    for (const member of members) {
      if (member.key === key) continue;
      mergeEndpoint(target, member);
      delete this.state.endpoints[member.key];
      alias.set(member.key, key);
    }
    this.state.endpoints[key] = target;
    return members.length - 1;
  }

  #remap(alias: Map<string, string>) {
    const to = (key: string) => alias.get(key) ?? key;
    const edges: Record<string, Edge> = {};
    for (const edge of Object.values(this.state.edges)) {
      const from = to(edge.from);
      const target = to(edge.to);
      if (from === target) continue;
      const id = `${edge.kind}|${from}|${target}`;
      const existing = edges[id];
      if (existing) {
        existing.count += edge.count;
        for (const evidence of edge.evidence) if (existing.evidence.length < 4 && !existing.evidence.some((e) => e.source === evidence.source && e.target === evidence.target)) existing.evidence.push(evidence);
      } else edges[id] = { ...edge, from, to: target };
    }
    this.state.edges = edges;
    for (const scenario of this.state.scenarios) scenario.endpoints = [...new Set(scenario.endpoints.map(to))];
    for (const source of this.#flow.values()) source.key = to(source.key);
    if (this.#last) this.#last.key = to(this.#last.key);
    this.state.newSinceFreeze = [...new Set(this.state.newSinceFreeze.map(to))].filter((key) => key in this.state.endpoints);
  }

  // ---------------------------------------------------------------------------------- queries

  endpoints(): EndpointStats[] {
    return Object.values(this.state.endpoints);
  }

  /** The inferred schema of an endpoint's response for a status, or its request body (`status` = 'request'). */
  schemaOf(endpoint: EndpointStats, status: string): JsonSchema | null {
    const acc = status === 'request' ? endpoint.requestSchema : endpoint.responses[status];
    return acc && acc.n > 0 ? inferSchema(acc) : null;
  }

  findingsOf(endpoint: EndpointStats): { status: string; findings: SchemaFinding[] }[] {
    const out: { status: string; findings: SchemaFinding[] }[] = [];
    if (endpoint.requestSchema) out.push({ status: 'request', findings: schemaFindings(endpoint.requestSchema) });
    for (const [status, acc] of Object.entries(endpoint.responses)) out.push({ status, findings: schemaFindings(acc) });
    return out.filter((entry) => entry.findings.length);
  }

  // --------------------------------------------------------------------------------- contracts

  /** Freezes what has been learned as the contract; from now on responses are validated against it. */
  freeze(now = Date.now()): number {
    const schemas: FrozenContract['schemas'] = {};
    for (const endpoint of this.endpoints()) {
      const byStatus: Record<string, JsonSchema> = {};
      for (const status of Object.keys(endpoint.responses)) {
        const schema = this.schemaOf(endpoint, status);
        if (schema) byStatus[status] = schema;
      }
      schemas[endpoint.key] = byStatus;
      endpoint.validation = { checked: 0, failed: 0, violations: [] };
    }
    this.state.frozen = { at: now, schemas };
    this.state.mode = 'validation';
    this.state.newSinceFreeze = [];
    this.version++;
    return Object.keys(schemas).length;
  }

  /** Back to learning: the frozen contract is dropped (what was learned stays). */
  unfreeze(): void {
    this.state.frozen = null;
    this.state.mode = 'discovery';
    this.version++;
  }
}

// ------------------------------------------------------------------------------------ helpers

/** Fingerprint of an endpoint's most common success response, for the collapse comparison. */
function successShape(endpoint: EndpointStats): string | null {
  const status = Object.keys(endpoint.responses)
    .filter((code) => /^2/.test(code))
    .sort((a, b) => (endpoint.responses[b]?.n ?? 0) - (endpoint.responses[a]?.n ?? 0))[0];
  const acc = status ? endpoint.responses[status] : undefined;
  return acc && acc.n > 0 ? schemaFingerprint(inferSchema(acc)) : null;
}

function mostCommon<T>(values: T[]): { value: T | undefined; count: number } {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: { value: T | undefined; count: number } = { value: undefined, count: 0 };
  for (const [value, count] of counts) if (count > best.count) best = { value, count };
  return best;
}

const sumInto = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [key, count] of Object.entries(from)) bump(into, key, count);
};

/** Adds endpoint `from` into `into` (both describe the same endpoint). */
export function mergeEndpoint(into: EndpointStats, from: EndpointStats): void {
  into.calls += from.calls;
  into.firstSeen = Math.min(into.firstSeen, from.firstSeen);
  into.lastSeen = Math.max(into.lastSeen, from.lastSeen);
  for (const field of ['statuses', 'requestHeaders', 'responseHeaders', 'requestTypes', 'responseTypes', 'auth', 'formFields', 'scenarios'] as const) sumInto(into[field], from[field]);
  for (const example of from.urlExamples) if (into.urlExamples.length < MAX_EXAMPLES && !into.urlExamples.includes(example)) into.urlExamples.push(example);
  for (const [name, param] of Object.entries(from.query)) {
    const mine = (into.query[name] ??= { count: 0, types: {}, examples: [] });
    mine.count += param.count;
    sumInto(mine.types, param.types);
    for (const example of param.examples) if (mine.examples.length < MAX_EXAMPLES && !mine.examples.includes(example)) mine.examples.push(example);
  }
  if (from.requestSchema) into.requestSchema = into.requestSchema ? mergeSchemaAcc(into.requestSchema, from.requestSchema) : structuredClone(from.requestSchema);
  for (const [status, acc] of Object.entries(from.responses)) into.responses[status] = into.responses[status] ? mergeSchemaAcc(into.responses[status], acc) : structuredClone(acc);
  into.requestExample ??= from.requestExample;
  for (const [status, list] of Object.entries(from.responseExamples)) {
    const mine = (into.responseExamples[status] ??= []);
    for (const example of list) if (mine.length < 2) mine.push(example);
  }
  into.timing.n += from.timing.n;
  into.timing.sum += from.timing.sum;
  into.timing.max = Math.max(into.timing.max, from.timing.max);
  into.timing.samples = [...into.timing.samples, ...from.timing.samples].slice(0, 100);
  into.size.sum += from.size.sum;
  into.size.max = Math.max(into.size.max, from.size.max);
  sumInto(into.incomplete as unknown as Record<string, number>, from.incomplete as unknown as Record<string, number>);
  into.validation.checked += from.validation.checked;
  into.validation.failed += from.validation.failed;
  for (const violation of from.validation.violations) if (into.validation.violations.length < MAX_VIOLATIONS) into.validation.violations.push(violation);
}

export function percentile95(timing: Timing): number {
  if (!timing.samples.length) return 0;
  const sorted = timing.samples.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

export { shapeOf };
