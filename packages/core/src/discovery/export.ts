// Documentation generated from a discovery session: OpenAPI 3.1 (JSON and YAML), one JSON Schema
// per shared structure, TypeScript interfaces, Markdown, a self-contained HTML report and the
// dependency graph. Everything is described as inferred from observed traffic, and nothing
// here can hold a credential: the model keeps none, and examples were scrubbed when recorded.
import { singular } from './normalize.ts';
import { layoutGraph, GRAPH_BOX } from './graph.ts';
import { percentile95, type DiscoveryModel, type EndpointStats } from './model.ts';
import { canonicalSchema, schemaFingerprint, type JsonSchema } from './schema.ts';
import { createZip, type ZipFile } from './zip.ts';

// ------------------------------------------------------------------------------------ helpers

const pascal = (text: string) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');

const NOTE = 'Inferred from observed traffic; not an official contract. A field missing from the samples is not proven optional.';

/** The path without `api` and version prefixes, to name and group things after the resource. */
function resourceSegments(template: string): string[] {
  return template
    .split('/')
    .filter((segment) => segment && !segment.startsWith('{') && !/^(api|rest|v\d+(\.\d+)?)$/i.test(segment));
}

function tagOf(endpoint: EndpointStats): string {
  return endpoint.operation ? 'graphql' : (resourceSegments(endpoint.template)[0] ?? 'root');
}

function operationId(endpoint: EndpointStats): string {
  const named = endpoint.operation ? pascal(endpoint.operation) : endpoint.template.split('/').filter(Boolean).map((s) => pascal(s.replace(/[{}]/g, ''))).join('');
  return `${endpoint.method.toLowerCase()}${named || 'Root'}`;
}

/** Endpoints by tag, in a stable order. */
function byTag(endpoints: EndpointStats[]): Map<string, EndpointStats[]> {
  const groups = new Map<string, EndpointStats[]>();
  for (const endpoint of endpoints.toSorted((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method))) {
    const tag = tagOf(endpoint);
    groups.set(tag, [...(groups.get(tag) ?? []), endpoint]);
  }
  return groups;
}

const dominant = (counts: Record<string, number>, fallback = '') => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;

// --------------------------------------------------------------------------------- components

interface Components {
  schemas: Record<string, JsonSchema>;
  /** Component name → endpoints that use it. */
  usedBy: Record<string, string[]>;
}

const isObjectSchema = (schema: JsonSchema) => {
  const type = schema.type;
  return (type === 'object' || (Array.isArray(type) && type.includes('object'))) && typeof schema.properties === 'object';
};

/**
 * Moves structures that are objects (or lists of objects) out of the operations into
 * `components.schemas`, named after the resource; equal structures share one component.
 */
function extractComponents(model: DiscoveryModel): { components: Components; ref: (endpoint: EndpointStats, status: string) => JsonSchema | null } {
  const components: Components = { schemas: {}, usedBy: {} };
  const names = new Map<string, string>(); // fingerprint → component name
  const taken = new Set<string>();

  const nameFor = (endpoint: EndpointStats, status: string, schema: JsonSchema) => {
    const fingerprint = schemaFingerprint(schema);
    const known = names.get(fingerprint);
    if (known) return known;
    const resource = endpoint.operation ? pascal(endpoint.operation) : pascal(singular(resourceSegments(endpoint.template).at(-1) ?? 'Root'));
    const suffix = status === 'request' ? 'Request' : /^[45]/.test(status) ? 'Error' : '';
    const base = `${resource || 'Root'}${suffix}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    names.set(fingerprint, name);
    const { 'x-samples': _samples, ...rest } = schema;
    components.schemas[name] = rest;
    return name;
  };

  const use = (name: string, endpoint: EndpointStats) => {
    const list = (components.usedBy[name] ??= []);
    if (!list.includes(endpoint.key)) list.push(endpoint.key);
  };

  const ref = (endpoint: EndpointStats, status: string): JsonSchema | null => {
    const schema = model.schemaOf(endpoint, status);
    if (!schema) return null;
    if (isObjectSchema(schema) && Object.keys(schema.properties as object).length >= 1) {
      const name = nameFor(endpoint, status, schema);
      use(name, endpoint);
      return { $ref: `#/components/schemas/${name}` };
    }
    const items = schema.items as JsonSchema | undefined;
    if (schema.type === 'array' && items && isObjectSchema(items)) {
      const name = nameFor(endpoint, status, { ...items, 'x-inferred': true });
      use(name, endpoint);
      const { 'x-samples': samples, ...rest } = schema;
      return { ...rest, items: { $ref: `#/components/schemas/${name}` }, 'x-samples': samples };
    }
    return schema;
  };
  // every structure is named up front, in a stable order, so all exports agree on the names
  for (const endpoint of model.endpoints().toSorted((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method))) {
    for (const status of ['request', ...Object.keys(endpoint.responses).sort()]) ref(endpoint, status);
  }
  return { components, ref };
}

// -------------------------------------------------------------------------------------- OpenAPI

const pathSchemaOf = (kind: string): JsonSchema => (kind === 'integer' ? { type: 'integer' } : kind === 'uuid' ? { type: 'string', format: 'uuid' } : kind === 'date' ? { type: 'string', format: 'date' } : { type: 'string' });

const STANDARD_HEADERS = /^(accept|accept-.*|authorization|cache-control|connection|content-.*|cookie|dnt|host|origin|pragma|priority|referer|sec-.*|user-agent|upgrade-insecure-requests|if-.*|x-requested-with|te)$/;

function jsonExample(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // a truncated example is dropped from the spec
  }
}

export function buildOpenApi(model: DiscoveryModel, options: { examples?: boolean } = {}): Record<string, unknown> {
  const { name } = model.state;
  const endpoints = model.endpoints();
  const { components, ref } = extractComponents(model);
  const origins = [...new Set(endpoints.map((endpoint) => endpoint.origin))].sort();
  const security: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};
  const withExamples = options.examples ?? true;

  for (const endpoint of endpoints.toSorted((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method))) {
    const pathKey = endpoint.operation ? `${endpoint.template}#${endpoint.operation}` : endpoint.template;
    const item = (paths[pathKey] ??= {});
    const method = endpoint.method.toLowerCase();
    if (item[method]) continue; // the same method and path on another origin
    const parameters: Record<string, unknown>[] = [
      ...endpoint.params.map((param) => ({ name: param.name, in: 'path', required: true, schema: pathSchemaOf(param.kind), example: param.example })),
      ...Object.entries(endpoint.query).map(([queryName, param]) => ({
        name: queryName,
        in: 'query',
        required: param.count === endpoint.calls,
        schema: { type: dominant(param.types, 'string') },
        ...(withExamples && param.examples[0] !== undefined ? { example: param.examples[0] } : {}),
      })),
      ...Object.keys(endpoint.requestHeaders)
        .filter((header) => !STANDARD_HEADERS.test(header) && header.startsWith('x-'))
        .map((header) => ({ name: header, in: 'header', required: endpoint.requestHeaders[header] === endpoint.calls, schema: { type: 'string' } })),
    ];

    const operation: Record<string, unknown> = {
      operationId: operationId(endpoint),
      tags: [tagOf(endpoint)],
      summary: `${endpoint.method} ${endpoint.operation ?? endpoint.template}`,
      description: `Observed ${endpoint.calls} time(s). ${NOTE}`,
      ...(parameters.length ? { parameters } : {}),
      'x-observed-calls': endpoint.calls,
    };
    if (endpoint.operation) operation['x-graphql-operation'] = endpoint.operation;

    // request body
    const requestSchema = ref(endpoint, 'request');
    const requestType = dominant(endpoint.requestTypes);
    if (requestSchema || Object.keys(endpoint.formFields).length) {
      const media = requestSchema
        ? { schema: requestSchema, ...(withExamples && jsonExample(endpoint.requestExample) !== undefined ? { example: jsonExample(endpoint.requestExample) } : {}) }
        : { schema: { type: 'object', properties: Object.fromEntries(Object.keys(endpoint.formFields).map((field) => [field, { type: 'string' }])) } };
      operation.requestBody = { content: { [requestType || (requestSchema ? 'application/json' : 'application/x-www-form-urlencoded')]: media } };
    }

    // responses: every status seen, with a schema where a body was observed
    const responses: Record<string, unknown> = {};
    const responseType = dominant(endpoint.responseTypes, 'application/json');
    for (const status of Object.keys(endpoint.statuses).sort()) {
      const key = status === 'failed' ? 'default' : status;
      const bodyKey = status in endpoint.responses ? status : /^\dXX$/.test(status[0] + 'XX') && `${status[0]}XX` in endpoint.responses ? `${status[0]}XX` : null;
      const schema = bodyKey ? ref(endpoint, bodyKey) : null;
      const example = bodyKey && withExamples ? jsonExample(endpoint.responseExamples[bodyKey]?.[0]) : undefined;
      responses[key] = {
        description: status === 'failed' ? 'The request failed (no response)' : `HTTP ${status} (${endpoint.statuses[status]} observed)`,
        ...(schema ? { content: { [responseType]: { schema, ...(example !== undefined ? { example } : {}) } } } : {}),
      };
    }
    operation.responses = Object.keys(responses).length ? responses : { default: { description: 'No response observed' } };

    // authentication seen on this endpoint
    const schemes: string[] = [];
    for (const seen of Object.keys(endpoint.auth)) {
      if (seen === 'bearer') security.bearerAuth = { type: 'http', scheme: 'bearer' };
      else if (seen === 'basic') security.basicAuth = { type: 'http', scheme: 'basic' };
      else if (seen === 'api-key') security.apiKeyAuth = { type: 'apiKey', in: 'header', name: 'X-API-Key' };
      else continue; // cookies and unknown schemes are not described: their names are not known
      schemes.push(seen === 'bearer' ? 'bearerAuth' : seen === 'basic' ? 'basicAuth' : 'apiKeyAuth');
    }
    if (schemes.length) operation.security = schemes.map((scheme) => ({ [scheme]: [] }));
    if (origins.length > 1) operation.servers = [{ url: endpoint.origin }];
    item[method] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: name,
      version: '0.0.0-discovered',
      description: `API map generated by BetterDevTools from ${model.state.seen} observed request(s). ${NOTE}`,
      'x-inferred': true,
    },
    ...(origins.length ? { servers: origins.map((url) => ({ url })) } : {}),
    tags: [...byTag(endpoints).keys()].map((tag) => ({ name: tag })),
    paths,
    components: { schemas: components.schemas, ...(Object.keys(security).length ? { securitySchemes: security } : {}) },
  };
}

// ----------------------------------------------------------------------------------------- YAML

const YAML_PLAIN = /^[A-Za-z_./][A-Za-z0-9_./ -]*$/;
const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~|[-+]?\d[\d_.eE+-]*)$/i;

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return YAML_PLAIN.test(value) && !YAML_RESERVED.test(value) && !value.endsWith(' ') ? value : JSON.stringify(value);
  return String(value);
}

/** YAML for JSON-compatible data (what an OpenAPI document is made of). */
export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => {
        if (typeof item === 'object' && item !== null && (Array.isArray(item) ? item.length : Object.keys(item).length)) {
          const inner = toYaml(item, indent + 1).replace(/^\s+/, '');
          return `${pad}- ${inner}`;
        }
        return `${pad}- ${typeof item === 'object' && item !== null ? (Array.isArray(item) ? '[]' : '{}') : yamlScalar(item)}`;
      })
      .join('\n');
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (!entries.length) return '{}';
    return entries
      .map(([key, child]) => {
        const name = YAML_PLAIN.test(key) && !YAML_RESERVED.test(key) ? key : JSON.stringify(key);
        if (typeof child === 'object' && child !== null && (Array.isArray(child) ? child.length : Object.keys(child).length)) {
          return `${pad}${name}:\n${toYaml(child, indent + 1)}`;
        }
        return `${pad}${name}: ${typeof child === 'object' && child !== null ? (Array.isArray(child) ? '[]' : '{}') : yamlScalar(child)}`;
      })
      .join('\n');
  }
  return `${pad}${yamlScalar(value)}`;
}

// ------------------------------------------------------------------------------------ TypeScript

const tsKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/** A TypeScript type for an inferred schema; `$ref`s become the component's name. */
export function schemaToTs(schema: JsonSchema, indent = 0): string {
  const pad = '  '.repeat(indent + 1);
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop()!;
  if (Array.isArray(schema.anyOf)) return [...new Set((schema.anyOf as JsonSchema[]).map((option) => schemaToTs(option, indent)))].join(' | ');
  const declared = schema.type;
  const kinds = declared === undefined ? [] : Array.isArray(declared) ? (declared as string[]) : [declared as string];
  if (!kinds.length) return 'unknown';
  const parts = kinds.map((kind) => {
    switch (kind) {
      case 'string':
        return Array.isArray(schema.enum) ? (schema.enum as string[]).map((value) => JSON.stringify(value)).join(' | ') : 'string';
      case 'integer':
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array': {
        const item = schema.items ? schemaToTs(schema.items as JsonSchema, indent) : 'unknown';
        return /[|&]/.test(item) ? `(${item})[]` : `${item}[]`;
      }
      case 'object': {
        const properties = schema.properties as Record<string, JsonSchema> | undefined;
        if (!properties) return schema.additionalProperties ? `Record<string, ${schemaToTs(schema.additionalProperties as JsonSchema, indent)}>` : 'Record<string, unknown>';
        const required = new Set((schema.required as string[] | undefined) ?? []);
        const lines = Object.entries(properties).map(([key, child]) => `${pad}${tsKey(key)}${required.has(key) ? '' : '?'}: ${schemaToTs(child, indent + 1)};`);
        return lines.length ? `{\n${lines.join('\n')}\n${'  '.repeat(indent)}}` : 'Record<string, never>';
      }
      default:
        return 'unknown';
    }
  });
  return [...new Set(parts)].join(' | ');
}

export function buildTypeScript(model: DiscoveryModel): string {
  const { components } = extractComponents(model);
  const out = [`// Generated by BetterDevTools from "${model.state.name}". ${NOTE}`, ''];
  for (const [name, schema] of Object.entries(components.schemas).sort(([a], [b]) => a.localeCompare(b))) {
    const body = schemaToTs(schema);
    out.push(body.startsWith('{') ? `export interface ${name} ${body}` : `export type ${name} = ${body};`, '');
  }
  return out.join('\n');
}

// -------------------------------------------------------------------------------- dependencies

export interface DependencyGraph {
  nodes: { id: string; label: string; calls: number }[];
  edges: { from: string; to: string; kind: string; count: number; evidence: { source: string; target: string }[] }[];
}

const shortLabel = (endpoint: EndpointStats) => `${endpoint.method} ${endpoint.operation ?? endpoint.template}`;

export function buildDependencyGraph(model: DiscoveryModel, kinds: ('data' | 'temporal')[] = ['data', 'temporal']): DependencyGraph {
  const edges = Object.values(model.state.edges).filter((edge) => kinds.includes(edge.kind) && model.state.endpoints[edge.from] && model.state.endpoints[edge.to]);
  const used = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  return {
    nodes: [...used].map((id) => ({ id, label: shortLabel(model.state.endpoints[id]!), calls: model.state.endpoints[id]!.calls })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, count: edge.count, evidence: edge.evidence })),
  };
}

// ------------------------------------------------------------------------------------- Markdown

export function buildMarkdown(model: DiscoveryModel): string {
  const { components } = extractComponents(model);
  const endpoints = model.endpoints();
  const graph = buildDependencyGraph(model, ['data']);
  const out: string[] = [`# ${model.state.name}`, '', `> ${NOTE}`, '', `${endpoints.length} endpoints, ${Object.keys(components.schemas).length} shared schemas, ${new Set(endpoints.map((e) => e.origin)).size} origin(s), ${model.state.seen} requests observed.`, ''];
  out.push('| Method | Endpoint | Status | Calls |', '| --- | --- | --- | ---: |');
  for (const endpoint of endpoints.toSorted((a, b) => a.template.localeCompare(b.template))) {
    out.push(`| ${endpoint.method} | \`${endpoint.operation ?? endpoint.template}\` | ${Object.keys(endpoint.statuses).join(', ')} | ${endpoint.calls} |`);
  }
  for (const [tag, group] of byTag(endpoints)) {
    out.push('', `## ${tag}`);
    for (const endpoint of group) {
      out.push('', `### ${endpoint.method} ${endpoint.operation ?? endpoint.template}`, '', `Origin: ${endpoint.origin} · ${endpoint.calls} call(s) · avg ${Math.round(endpoint.timing.n ? endpoint.timing.sum / endpoint.timing.n : 0)} ms · p95 ${Math.round(percentile95(endpoint.timing))} ms`);
      if (endpoint.params.length) out.push('', 'Path parameters: ' + endpoint.params.map((p) => `\`${p.name}\` (${p.kind})`).join(', '));
      if (Object.keys(endpoint.query).length) out.push('', 'Query: ' + Object.entries(endpoint.query).map(([n, p]) => `\`${n}\`${p.count === endpoint.calls ? '' : ' (optional)'}`).join(', '));
      if (Object.keys(endpoint.auth).length) out.push('', `Authentication seen: ${Object.keys(endpoint.auth).join(', ')}`);
      const request = model.schemaOf(endpoint, 'request');
      if (request) out.push('', '**Request body**', '', '```ts', schemaToTs(request), '```');
      for (const status of Object.keys(endpoint.responses).sort()) {
        const schema = model.schemaOf(endpoint, status);
        if (schema) out.push('', `**Response ${status}** (${endpoint.statuses[status] ?? '?'} observed)`, '', '```ts', schemaToTs(schema), '```');
        const example = endpoint.responseExamples[status]?.[0];
        if (example) out.push('', '<details><summary>Example</summary>', '', '```json', example, '```', '', '</details>');
      }
    }
  }
  if (graph.edges.length) {
    out.push('', '## Dependencies', '', '```mermaid', 'graph LR');
    const id = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
    for (const node of graph.nodes) out.push(`  ${id.get(node.id)}["${node.label.replace(/"/g, "'")}"]`);
    for (const edge of graph.edges) out.push(`  ${id.get(edge.from)} -->|${(edge.evidence[0]?.target ?? 'data').replace(/[|"]/g, '')}| ${id.get(edge.to)}`);
    out.push('```');
  }
  if (model.state.scenarios.length) {
    out.push('', '## Scenarios');
    for (const scenario of model.state.scenarios) {
      out.push('', `### ${scenario.name}`, '', ...scenario.endpoints.map((key) => `- ${model.state.endpoints[key] ? shortLabel(model.state.endpoints[key]!) : key}`));
    }
  }
  return out.join('\n') + '\n';
}

// ----------------------------------------------------------------------------------------- HTML

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function graphSvg(model: DiscoveryModel): string {
  const graph = buildDependencyGraph(model, ['data']);
  if (!graph.edges.length) return '';
  const layout = layoutGraph(graph.nodes, graph.edges);
  const { width, height } = GRAPH_BOX;
  return `<svg viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" role="img" aria-label="Dependency graph">${layout.edges
    .map((edge) => `<path d="${edge.path}" fill="none" stroke="#8250df" stroke-width="1.4"/>`)
    .join('')}${layout.nodes
    .map(
      (node) =>
        `<g><rect x="${node.x}" y="${node.y}" width="${width}" height="${height}" rx="5" fill="#f6f8fa" stroke="#d1d9e0"/><text x="${node.x + 8}" y="${node.y + 18}" font-size="11" font-family="monospace">${escapeHtml(node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label)}</text></g>`,
    )
    .join('')}</svg>`;
}

export function buildReportHtml(model: DiscoveryModel): string {
  const endpoints = model.endpoints().toSorted((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method));
  const rows = endpoints
    .map((endpoint) => {
      const details = [
        ...Object.keys(endpoint.responses).sort().flatMap((status) => {
          const schema = model.schemaOf(endpoint, status);
          return schema ? [`<h4>Response ${escapeHtml(status)}</h4><pre>${escapeHtml(schemaToTs(schema))}</pre>`] : [];
        }),
        ...(model.schemaOf(endpoint, 'request') ? [`<h4>Request body</h4><pre>${escapeHtml(schemaToTs(model.schemaOf(endpoint, 'request')!))}</pre>`] : []),
        ...Object.values(endpoint.responseExamples).flat().slice(0, 1).map((example) => `<h4>Example</h4><pre>${escapeHtml(example)}</pre>`),
      ].join('');
      return `<details><summary><b class="m ${endpoint.method}">${endpoint.method}</b> <code>${escapeHtml(endpoint.operation ?? endpoint.template)}</code> <span>${Object.keys(endpoint.statuses).join(' ')} · ${endpoint.calls} call(s)</span></summary>${details || '<p>No body observed.</p>'}</details>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(model.state.name)}: API report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1f2328}code,pre{font-family:ui-monospace,Consolas,monospace;font-size:12px}pre{background:#f6f8fa;padding:.6rem;border-radius:6px;overflow:auto}details{border-bottom:1px solid #d1d9e0;padding:.4rem 0}summary{cursor:pointer}summary span{color:#656d76;margin-inline-start:.5rem}.m{display:inline-block;min-width:3.5rem;text-align:center;border-radius:4px;background:#ddf4ff;color:#0550ae;font-size:11px}.POST{background:#dafbe1;color:#1a7f37}.DELETE{background:#ffebe9;color:#cf222e}.PUT,.PATCH{background:#fff8c5;color:#7d4e00}.note{background:#fff8c5;padding:.5rem .8rem;border-radius:6px}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}pre{background:#161b22}details{border-color:#30363d}.note{background:#3d3214}}</style></head>
<body><h1>${escapeHtml(model.state.name)}</h1><p class="note">${escapeHtml(NOTE)}</p>
<p>${endpoints.length} endpoints from ${model.state.seen} observed requests.</p>
<h2>Endpoints</h2>${rows}
${graphSvg(model) ? `<h2>Dependencies</h2><div style="overflow:auto">${graphSvg(model)}</div>` : ''}
</body></html>`;
}

// ---------------------------------------------------------------------------------- the package

export type DiscoveryExportFormat = 'package' | 'openapi-yaml' | 'openapi-json' | 'schemas' | 'typescript' | 'markdown' | 'report' | 'graph';

const slug = (text: string) => text.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'discovery';

/** The files of one export format (the `package` format is the whole folder). */
export function buildExportFiles(model: DiscoveryModel, format: DiscoveryExportFormat): ZipFile[] {
  const openapi = () => buildOpenApi(model);
  const schemaFiles = (): ZipFile[] => {
    const { components } = extractComponents(model);
    return Object.entries(components.schemas).map(([name, schema]) => ({
      path: `schemas/${name}.schema.json`,
      text: JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: name, description: NOTE, ...canonicalSchemaKeepingInference(schema) }, null, 2),
    }));
  };
  const graph = () => ({ path: 'dependencies/graph.json', text: JSON.stringify(buildDependencyGraph(model), null, 2) });
  switch (format) {
    case 'openapi-yaml':
      return [{ path: 'openapi.yaml', text: `${toYaml(openapi())}\n` }];
    case 'openapi-json':
      return [{ path: 'openapi.json', text: JSON.stringify(openapi(), null, 2) }];
    case 'schemas':
      return schemaFiles();
    case 'typescript':
      return [{ path: 'types.ts', text: buildTypeScript(model) }];
    case 'markdown':
      return [{ path: 'api.md', text: buildMarkdown(model) }];
    case 'report':
      return [{ path: 'report.html', text: buildReportHtml(model) }];
    case 'graph':
      return [graph()];
    case 'package': {
      const groups = [...byTag(model.endpoints())].map(([tag, group]): ZipFile => ({
        path: `endpoints/${slug(tag)}.json`,
        text: JSON.stringify(
          group.map((endpoint) => ({
            method: endpoint.method,
            origin: endpoint.origin,
            path: endpoint.template,
            operation: endpoint.operation,
            calls: endpoint.calls,
            statuses: endpoint.statuses,
            pathParameters: endpoint.params,
            query: endpoint.query,
            requestHeaders: Object.keys(endpoint.requestHeaders),
            authentication: Object.keys(endpoint.auth),
            requestSchema: model.schemaOf(endpoint, 'request') ?? undefined,
            responses: Object.fromEntries(Object.keys(endpoint.responses).map((status) => [status, model.schemaOf(endpoint, status)])),
            examples: endpoint.responseExamples,
          })),
          null,
          2,
        ),
      }));
      return [
        { path: 'openapi.yaml', text: `${toYaml(openapi())}\n` },
        { path: 'openapi.json', text: JSON.stringify(openapi(), null, 2) },
        ...schemaFiles(),
        { path: 'types.ts', text: buildTypeScript(model) },
        ...groups,
        graph(),
        { path: 'api.md', text: buildMarkdown(model) },
        { path: 'report.html', text: buildReportHtml(model) },
      ];
    }
  }
}

/** A component schema without the per-session sample counts, keeping the "inferred" note. */
function canonicalSchemaKeepingInference(schema: JsonSchema): JsonSchema {
  return { ...canonicalSchema(schema), 'x-inferred': true };
}

/** The finished file(s) to save: one file as it is, several as a zip. */
export function buildExport(model: DiscoveryModel, format: DiscoveryExportFormat): { name: string; mime: string; bytes: Uint8Array } {
  const files = buildExportFiles(model, format);
  const base = slug(model.state.name);
  if (files.length === 1) {
    const [file] = files as [ZipFile];
    const mime = file.path.endsWith('.json') ? 'application/json' : file.path.endsWith('.html') ? 'text/html' : 'text/plain';
    return { name: `${base}.${file.path}`, mime, bytes: new TextEncoder().encode(file.text) };
  }
  return { name: `${base}-discovery-export.zip`, mime: 'application/zip', bytes: createZip(files.map((file) => ({ ...file, path: `discovery-export/${file.path}` }))) };
}

/** The shared structures (components) of a session, with the endpoints that use each. */
export function listComponents(model: DiscoveryModel): { name: string; schema: JsonSchema; usedBy: string[] }[] {
  const { components } = extractComponents(model);
  return Object.entries(components.schemas)
    .map(([name, schema]) => ({ name, schema, usedBy: components.usedBy[name] ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { shortLabel as endpointLabel };
