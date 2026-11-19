// What a session shows about itself: how much of the traffic is covered by schemas and examples,
// and how two sessions differ (new, removed and changed endpoints).
import type { DiscoveryModel, EndpointStats } from './model.ts';
import type { JsonSchema } from './schema.ts';

export const THIN_SAMPLES = 3;

export interface Coverage {
  endpoints: number;
  withSchema: number;
  withExamples: number;
  /** Endpoints of the frozen contract that were checked at least once. */
  validated: number;
  frozen: number;
  withErrors: number;
  inconsistent: number;
  thin: number;
  schemaPct: number;
  contractPct: number;
  noSchema: string[];
  erroring: string[];
  inconsistentKeys: string[];
  thinKeys: string[];
  /** Frozen endpoints nobody has called since the freeze. */
  unexercised: string[];
  newSinceFreeze: string[];
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Coverage of the observed traffic, not of the whole API: an endpoint nobody called is not here. */
export function coverageOf(model: DiscoveryModel): Coverage {
  const endpoints = model.endpoints();
  const withSchema = endpoints.filter((endpoint) => Object.values(endpoint.responses).some((acc) => acc.n > 0 && Object.keys(acc.types).some((type) => type !== 'null')));
  const frozen = model.state.frozen;
  const frozenEndpoints = frozen ? Object.keys(frozen.schemas).map((key) => model.state.endpoints[key]).filter((e): e is EndpointStats => Boolean(e)) : [];
  const validated = frozenEndpoints.filter((endpoint) => endpoint.validation.checked > 0);
  const inconsistent = endpoints.filter((endpoint) =>
    model.findingsOf(endpoint).some((entry) => entry.findings.some((finding) => finding.kind === 'type-conflict')),
  );
  const erroring = endpoints.filter((endpoint) => Object.keys(endpoint.statuses).some((status) => status === 'failed' || Number(status) >= 400));
  const thin = endpoints.filter((endpoint) => endpoint.calls < THIN_SAMPLES);
  const keys = (list: EndpointStats[]) => list.map((endpoint) => endpoint.key);
  return {
    endpoints: endpoints.length,
    withSchema: withSchema.length,
    withExamples: endpoints.filter((endpoint) => Object.keys(endpoint.responseExamples).length || endpoint.requestExample).length,
    validated: validated.length,
    frozen: frozenEndpoints.length,
    withErrors: erroring.length,
    inconsistent: inconsistent.length,
    thin: thin.length,
    schemaPct: pct(withSchema.length, endpoints.length),
    contractPct: pct(validated.length, frozenEndpoints.length),
    noSchema: keys(endpoints.filter((endpoint) => !withSchema.includes(endpoint))),
    erroring: keys(erroring),
    inconsistentKeys: keys(inconsistent),
    thinKeys: keys(thin),
    unexercised: keys(frozenEndpoints.filter((endpoint) => endpoint.validation.checked === 0)),
    newSinceFreeze: model.state.newSinceFreeze.filter((key) => key in model.state.endpoints),
  };
}

// ---------------------------------------------------------------------------- comparing sessions

export interface SchemaChange {
  path: string;
  change: 'added' | 'removed' | 'type' | 'required' | 'optional';
  detail: string;
}

const typesOf = (schema: JsonSchema): string => {
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).map(typesOf).join(' | ');
  const type = schema.type;
  return Array.isArray(type) ? type.join(' | ') : typeof type === 'string' ? type : 'any';
};

/** Differences between two inferred schemas, field by field. */
export function schemaDiff(before: JsonSchema, after: JsonSchema, path = '$', out: SchemaChange[] = []): SchemaChange[] {
  if (out.length >= 100) return out;
  if (typesOf(before) !== typesOf(after)) out.push({ path, change: 'type', detail: `${typesOf(before)} → ${typesOf(after)}` });
  const was = (before.properties ?? {}) as Record<string, JsonSchema>;
  const now = (after.properties ?? {}) as Record<string, JsonSchema>;
  const wasRequired = new Set((before.required ?? []) as string[]);
  const nowRequired = new Set((after.required ?? []) as string[]);
  for (const key of Object.keys(now)) {
    if (!(key in was)) out.push({ path: `${path}.${key}`, change: 'added', detail: typesOf(now[key]!) });
    else {
      schemaDiff(was[key]!, now[key]!, `${path}.${key}`, out);
      if (wasRequired.has(key) && !nowRequired.has(key)) out.push({ path: `${path}.${key}`, change: 'optional', detail: 'was always present, now sometimes missing' });
      if (!wasRequired.has(key) && nowRequired.has(key)) out.push({ path: `${path}.${key}`, change: 'required', detail: 'now always present' });
    }
  }
  for (const key of Object.keys(was)) if (!(key in now)) out.push({ path: `${path}.${key}`, change: 'removed', detail: typesOf(was[key]!) });
  if (before.items && after.items) schemaDiff(before.items as JsonSchema, after.items as JsonSchema, `${path}[]`, out);
  return out;
}

export interface SessionDiff {
  added: string[];
  removed: string[];
  changed: { key: string; statuses: { added: string[]; removed: string[] }; schemas: { status: string; changes: SchemaChange[] }[] }[];
}

/** What changed from `before` to `after`: endpoints that appeared or vanished, and changed responses. */
export function diffSessions(before: DiscoveryModel, after: DiscoveryModel): SessionDiff {
  const a = before.state.endpoints;
  const b = after.state.endpoints;
  const changed: SessionDiff['changed'] = [];
  for (const key of Object.keys(b)) {
    const was = a[key];
    if (!was) continue;
    const now = b[key]!;
    const statuses = {
      added: Object.keys(now.statuses).filter((status) => !(status in was.statuses)),
      removed: Object.keys(was.statuses).filter((status) => !(status in now.statuses)),
    };
    const schemas = [...new Set([...Object.keys(was.responses), ...Object.keys(now.responses), ...(was.requestSchema || now.requestSchema ? ['request'] : [])])]
      .map((status) => {
        const left = before.schemaOf(was, status);
        const right = after.schemaOf(now, status);
        return { status, changes: left && right ? schemaDiff(left, right) : [] };
      })
      .filter((entry) => entry.changes.length);
    if (statuses.added.length || statuses.removed.length || schemas.length) changed.push({ key, statuses, schemas });
  }
  return { added: Object.keys(b).filter((key) => !(key in a)), removed: Object.keys(a).filter((key) => !(key in b)), changed };
}

