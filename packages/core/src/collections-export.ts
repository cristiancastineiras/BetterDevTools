// Exports a workspace's collections for other tools: Postman, OpenAPI (Swagger), HTTPie and cURL.
// Pure functions over the saved requests; nothing here touches the browser.
import type { RequestNode, TreeNode, Workspace } from './workspace.ts';

export const COLLECTION_FORMATS = ['postman', 'openapi', 'httpie', 'curl'] as const;
export type CollectionFormat = (typeof COLLECTION_FORMATS)[number];

export const COLLECTION_FILES: Record<CollectionFormat, { suffix: string; mime: string }> = {
  postman: { suffix: 'postman_collection.json', mime: 'application/json' },
  openapi: { suffix: 'openapi.json', mime: 'application/json' },
  httpie: { suffix: 'httpie.sh', mime: 'text/x-shellscript' },
  curl: { suffix: 'curl.sh', mime: 'text/x-shellscript' },
};

export interface CollectionExportOptions {
  /** Values of environment variables marked secret; left empty (or read from the shell) when false. */
  includeSecrets: boolean;
}

interface Flat {
  /** Names of the folders above the request. */
  path: string[];
  node: RequestNode;
}

function flatten(nodes: TreeNode[], path: string[] = []): Flat[] {
  return nodes.flatMap((node) => (node.kind === 'folder' ? flatten(node.children, [...path, node.name]) : [{ path, node }]));
}

const textLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

/** `Name: value` lines; lines without a colon are skipped. */
function headerPairs(text: string): [string, string][] {
  return textLines(text).flatMap((line): [string, string][] => {
    const i = line.indexOf(':', 1);
    return i < 1 ? [] : [[line.slice(0, i).trim(), line.slice(i + 1).trim()]];
  });
}

/** The saved URL with its query lines appended. */
function fullUrl(r: RequestNode): string {
  const query = textLines(r.query).join('&');
  if (!query) return r.url.trim();
  return `${r.url.trim()}${r.url.includes('?') ? '&' : '?'}${query}`;
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** The active environment's variables as name → value, secrets blanked unless asked for. */
function environment(ws: Workspace, options: CollectionExportOptions): Map<string, { value: string; secret: boolean }> {
  const env = ws.envs.find((e) => e.id === ws.activeEnvId);
  return new Map(
    (env?.vars ?? [])
      .filter((x) => x.key)
      .map((x) => [x.key, { value: x.secret && !options.includeSecrets ? '' : x.value, secret: x.secret }]),
  );
}

// ---------------------------------------------------------------------------------- Postman

function postmanItem(node: TreeNode): unknown {
  if (node.kind === 'folder') return { name: node.name, item: node.children.map(postmanItem) };
  const headers = headerPairs(node.headers);
  const json = headers.some(([name, value]) => /^content-type$/i.test(name) && /json/i.test(value));
  return {
    name: node.name,
    request: {
      method: node.method.toUpperCase(),
      header: headers.map(([key, value]) => ({ key, value })),
      url: fullUrl(node),
      ...(node.body ? { body: { mode: 'raw', raw: node.body, ...(json ? { options: { raw: { language: 'json' } } } : {}) } } : {}),
    },
  };
}

function toPostman(ws: Workspace, options: CollectionExportOptions): string {
  const env = ws.envs.find((e) => e.id === ws.activeEnvId);
  return JSON.stringify(
    {
      info: { _postman_id: ws.id, name: ws.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: ws.collections.map(postmanItem),
      // {{name}} placeholders are Postman's own syntax, so they are kept as they are
      variable: (env?.vars ?? [])
        .filter((x) => x.key)
        .map((x) => ({ key: x.key, value: x.secret && !options.includeSecrets ? '' : x.value, type: x.secret ? 'secret' : 'default' })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------------- OpenAPI

const OPENAPI_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const IMPLICIT_HEADERS = /^(content-type|accept|authorization|cookie)$/i;

function jsonOrText(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function toOpenApi(ws: Workspace, options: CollectionExportOptions): string {
  const vars = environment(ws, options);
  const resolve = (text: string) => text.replace(VARIABLE, (match, name: string) => vars.get(name)?.value ?? match);
  const paths: Record<string, Record<string, unknown>> = {};
  const origins = new Set<string>();
  const usedIds = new Set<string>();
  let skipped = 0;

  const requests = flatten(ws.collections).map((flat) => ({ ...flat, parsed: URL.parse(resolve(fullUrl(flat.node))) }));
  for (const { path, node, parsed } of requests) {
    const method = node.method.toLowerCase();
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !OPENAPI_METHODS.has(method)) {
      skipped++;
      continue;
    }
    origins.add(parsed.origin);
    const item = (paths[parsed.pathname] ??= {});
    if (item[method]) {
      skipped++; // one operation per method and path
      continue;
    }
    const headers = headerPairs(resolve(node.headers));
    const contentType = headers
      .find(([name]) => /^content-type$/i.test(name))?.[1]
      .split(';')[0]
      ?.trim();
    const body = resolve(node.body);
    const parsedBody = body ? jsonOrText(body) : undefined;
    const mime = contentType || (typeof parsedBody === 'string' ? 'text/plain' : 'application/json');
    let operationId = node.name.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || method;
    for (let n = 2; usedIds.has(operationId); n++) operationId = `${operationId}_${n}`;
    usedIds.add(operationId);
    const query = new Map<string, string>();
    for (const [key, value] of parsed.searchParams) if (!query.has(key)) query.set(key, value);
    item[method] = {
      operationId,
      summary: node.name,
      ...(path.length ? { tags: [path.join(' / ')] } : {}),
      parameters: [
        ...[...query].map(([name, example]) => ({ name, in: 'query', schema: { type: 'string' }, example })),
        ...headers
          .filter(([name]) => !IMPLICIT_HEADERS.test(name))
          .map(([name, example]) => ({ name, in: 'header', schema: { type: 'string' }, example })),
      ],
      ...(body ? { requestBody: { content: { [mime]: { example: parsedBody } } } } : {}),
      responses: { default: { description: 'Response' } },
    };
  }

  const servers = [...origins].map((url) => ({ url }));
  return JSON.stringify(
    {
      openapi: '3.0.3',
      info: {
        title: ws.name,
        version: '1.0.0',
        description: `Generated from the saved requests of "${ws.name}". Responses are not described.${skipped ? ` ${skipped} request(s) were skipped: unresolved variables, an unsupported method or a repeated method and path.` : ''}`,
      },
      servers,
      paths,
    },
    null,
    2,
  );
}

// ------------------------------------------------------------------------------ shell scripts

const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
const shellName = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

/**
 * One shell word for text that may hold {{variables}}: known values are written in, anything else
 * (unknown or secret variables) becomes "${NAME}", read from the shell when the script runs.
 */
function shellWord(text: string, vars: Map<string, { value: string; secret: boolean }>, needed: Set<string>): string {
  const parts: string[] = [];
  let literal = '';
  const flush = () => {
    if (literal) parts.push(shellQuote(literal));
    literal = '';
  };
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    literal += text.slice(last, match.index);
    last = match.index + match[0].length;
    const known = vars.get(match[1]!);
    if (known && !(known.secret && known.value === '')) {
      literal += known.value;
    } else {
      flush();
      needed.add(shellName(match[1]!));
      parts.push(`"\${${shellName(match[1]!)}}"`);
    }
  }
  literal += text.slice(last);
  flush();
  return parts.join('') || "''";
}

function toScript(ws: Workspace, options: CollectionExportOptions, tool: 'curl' | 'httpie'): string {
  const vars = environment(ws, options);
  const needed = new Set<string>();
  const word = (text: string) => shellWord(text, vars, needed);
  const blocks: string[] = [];
  let group = '';
  for (const { path, node } of flatten(ws.collections)) {
    const heading = path.join(' / ');
    const method = node.method.toUpperCase();
    const headers = headerPairs(node.headers);
    const parts =
      tool === 'curl'
        ? [
            'curl',
            ...(method === 'GET' ? [] : method === 'HEAD' ? ['-I'] : ['-X', method]),
            word(fullUrl(node)),
            ...headers.flatMap(([name, value]) => ['-H', word(`${name}: ${value}`)]),
            ...(node.body ? ['--data-raw', word(node.body)] : []),
          ]
        : [
            'http --ignore-stdin',
            method,
            word(fullUrl(node)),
            ...headers.map(([name, value]) => word(value ? `${name}:${value}` : `${name};`)),
            ...(node.body ? ['--raw', word(node.body)] : []),
          ];
    const title = `# ${oneLine(node.name)}`;
    blocks.push(
      heading !== group ? `\n# == ${oneLine(heading) || 'Requests'} ==\n${title}\n${parts.join(' ')}` : `${title}\n${parts.join(' ')}`,
    );
    group = heading;
  }
  const lines = ['#!/usr/bin/env bash', `# ${oneLine(ws.name)}, exported from BetterDevTools`];
  if (needed.size) lines.push(`# Set these before running: ${[...needed].join(', ')}`);
  return `${lines.join('\n')}\n${blocks.join('\n\n')}\n`;
}

// -------------------------------------------------------------------------------------- entry

/** The workspace's collections in another tool's format, as the text of the file to save. */
export function exportCollections(ws: Workspace, format: CollectionFormat, options: CollectionExportOptions): string {
  switch (format) {
    case 'postman':
      return toPostman(ws, options);
    case 'openapi':
      return toOpenApi(ws, options);
    case 'httpie':
      return toScript(ws, options, 'httpie');
    case 'curl':
      return toScript(ws, options, 'curl');
  }
}
