import * as v from 'valibot';
import { ImportError } from './har.ts';

export const SCHEMA_VERSION = 1;
export const WORKSPACE_FORMAT = 'betterdevtools.workspace';

/** Storage limits; imports beyond them are rejected before anything is written. */
export const LIMITS = { nodes: 5000, depth: 12, text: 1_000_000, name: 200, envs: 50, vars: 500, fileBytes: 20 << 20 };

const Id = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
const Name = v.pipe(v.string(), v.maxLength(LIMITS.name));
const Text = v.pipe(v.string(), v.maxLength(LIMITS.text));

export const VarSchema = v.object({ key: Name, value: Text, secret: v.boolean() });
export const EnvSchema = v.object({ id: Id, name: Name, vars: v.pipe(v.array(VarSchema), v.maxLength(LIMITS.vars)) });
export const RequestNodeSchema = v.object({
  kind: v.literal('request'),
  id: Id,
  name: Name,
  method: Name,
  url: Text,
  query: Text,
  headers: Text,
  body: Text,
});

export type Var = v.InferOutput<typeof VarSchema>;
export type Env = v.InferOutput<typeof EnvSchema>;
export type RequestNode = v.InferOutput<typeof RequestNodeSchema>;
export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  children: TreeNode[];
}
export type TreeNode = RequestNode | FolderNode;

export const FolderSchema: v.GenericSchema<FolderNode> = v.object({
  kind: v.literal('folder'),
  id: Id,
  name: Name,
  children: v.array(v.lazy(() => NodeSchema)),
});
const NodeSchema: v.GenericSchema<TreeNode> = v.union([RequestNodeSchema, FolderSchema]);

export const WorkspaceSchema = v.object({
  schemaVersion: v.literal(SCHEMA_VERSION),
  id: Id,
  name: Name,
  createdAt: v.number(),
  updatedAt: v.number(),
  activeEnvId: v.nullable(Id),
  envs: v.pipe(v.array(EnvSchema), v.maxLength(LIMITS.envs)),
  /** Top-level folders are the collections. */
  collections: v.array(FolderSchema),
});
export type Workspace = v.InferOutput<typeof WorkspaceSchema>;

// ------------------------------------------------------------------------------ migrations

/** Record migrations between schema versions; each step must be reversible (`down(up(x))` ≅ x). */
export interface Migration {
  from: number;
  up(doc: Record<string, unknown>): Record<string, unknown>;
  down(doc: Record<string, unknown>): Record<string, unknown>;
}

/** v1 is the first schema, so there is nothing to migrate yet. */
export const MIGRATIONS: Migration[] = [];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Moves a raw record to `target`, up or down. Newer-than-known data is refused, never truncated. */
export function migrate(doc: unknown, target = SCHEMA_VERSION, migrations = MIGRATIONS): Record<string, unknown> {
  if (!isRecord(doc) || typeof doc.schemaVersion !== 'number') throw new ImportError('Missing schemaVersion');
  let cur = doc;
  let ver = doc.schemaVersion;
  const known = Math.max(SCHEMA_VERSION, ...migrations.map((m) => m.from + 1));
  if (ver > known) throw new ImportError(`Created by a newer BetterDevTools (schema ${ver}); update the extension first`);
  while (ver !== target) {
    const up = ver < target;
    const step = migrations.find((m) => m.from === (up ? ver : ver - 1));
    if (!step) throw new ImportError(`No migration from schema ${ver}`);
    cur = up ? step.up(cur) : step.down(cur);
    ver += up ? 1 : -1;
    cur = { ...cur, schemaVersion: ver };
  }
  return cur;
}

/** Validates a stored or imported record; returns null (never throws) for corrupt data. */
export function readWorkspace(raw: unknown): Workspace | null {
  try {
    const r = v.safeParse(WorkspaceSchema, migrate(raw));
    return r.success ? r.output : null;
  } catch (e) {
    if (e instanceof ImportError) return null;
    throw e;
  }
}

/** Rejects JSON nested deeper than `max` before the recursive schema ever sees it. */
function depthOk(x: unknown, max: number): boolean {
  if (max < 0) return false;
  if (typeof x !== 'object' || x === null) return true;
  return Object.values(x).every((c) => depthOk(c, max - 1));
}

export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((n, x) => n + 1 + (x.kind === 'folder' ? countNodes(x.children) : 0), 0);
}

/**
 * Parses an untrusted workspace file into a new workspace (fresh id). Nothing is persisted here,
 * so a corrupt file can never damage stored data.
 */
export function parseWorkspaceFile(text: string): Workspace {
  if (text.length > LIMITS.fileBytes) throw new ImportError('File is larger than the 20 MB limit');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (cause) {
    throw new ImportError('The file is not valid JSON', { cause });
  }
  if (!isRecord(doc) || doc.format !== WORKSPACE_FORMAT) throw new ImportError('Not a BetterDevTools workspace file');
  // workspace → collections → folder → children → node: 5 levels per folder depth step budget
  if (!depthOk(doc, LIMITS.depth * 2 + 8)) throw new ImportError(`Folders are nested deeper than ${LIMITS.depth} levels`);
  const r = v.safeParse(WorkspaceSchema, migrate(doc.workspace));
  if (!r.success) {
    const issue = r.issues[0];
    const path = issue.path?.map((p) => String(p.key)).join('.') ?? '';
    throw new ImportError(`Invalid workspace: ${path ? `${path}: ` : ''}${issue.message}`);
  }
  if (countNodes(r.output.collections) > LIMITS.nodes) throw new ImportError(`More than ${LIMITS.nodes} items`);
  return { ...r.output, id: newId(), name: `${r.output.name} (imported)`, updatedAt: Date.now() };
}

export function workspaceFile(ws: Workspace, includeSecrets: boolean): string {
  const envs = ws.envs.map((e) => ({ ...e, vars: e.vars.map((x) => (x.secret && !includeSecrets ? { ...x, value: '' } : x)) }));
  return JSON.stringify({ format: WORKSPACE_FORMAT, exportedAt: new Date().toISOString(), workspace: { ...ws, envs } }, null, 2);
}

// ---------------------------------------------------------------------------- tree editing

export const newId = (): string => crypto.randomUUID();

export function createWorkspace(name: string): Workspace {
  const now = Date.now();
  const env: Env = { id: newId(), name: 'Default', vars: [] };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    activeEnvId: env.id,
    envs: [env],
    collections: [{ kind: 'folder', id: newId(), name: 'My collection', children: [] }],
  };
}

/** Finds the array holding `id` and its index (top-level collections included). */
export function locate(nodes: TreeNode[], id: string): { list: TreeNode[]; index: number } | null {
  for (const [index, n] of nodes.entries()) {
    if (n.id === id) return { list: nodes, index };
    if (n.kind === 'folder') {
      const found = locate(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  const at = locate(nodes, id);
  return at ? (at.list[at.index] ?? null) : null;
}

function contains(node: TreeNode, id: string): boolean {
  return node.id === id || (node.kind === 'folder' && node.children.some((c) => contains(c, id)));
}

/** Folders by path, for "Move to…" pickers. */
export function folderPaths(nodes: TreeNode[], prefix = ''): { id: string; path: string }[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder' ? [{ id: n.id, path: prefix + n.name }, ...folderPaths(n.children, `${prefix}${n.name} / `)] : [],
  );
}

function depthOf(nodes: TreeNode[], id: string, d = 1): number {
  for (const n of nodes) {
    if (n.id === id) return d;
    if (n.kind === 'folder') {
      const x = depthOf(n.children, id, d + 1);
      if (x) return x;
    }
  }
  return 0;
}

/** Folder levels inside a node: 0 for a request, 1 for an empty folder. */
const height = (n: TreeNode): number => (n.kind === 'folder' ? 1 + Math.max(0, ...n.children.map(height)) : 0);

/** Throws when `node` cannot go under `parentId`; checks everything before anything is changed. */
function targetFolder(ws: Workspace, parentId: string, node: TreeNode): FolderNode {
  const parent = findNode(ws.collections, parentId);
  if (parent?.kind !== 'folder') throw new ImportError('Target folder not found');
  if (contains(node, parentId)) throw new ImportError('A folder cannot move into itself');
  if (depthOf(ws.collections, parentId) + height(node) > LIMITS.depth) throw new ImportError(`Folders nest at most ${LIMITS.depth} levels`);
  return parent;
}

/** Adds `node` to folder `parentId` (or as a collection when null and it is a folder). */
export function insertNode(ws: Workspace, parentId: string | null, node: TreeNode): void {
  if (countNodes(ws.collections) + countNodes([node]) > LIMITS.nodes)
    throw new ImportError(`Workspaces hold at most ${LIMITS.nodes} items`);
  if (parentId === null) {
    if (node.kind !== 'folder') throw new ImportError('Requests must live inside a collection');
    if (height(node) > LIMITS.depth) throw new ImportError(`Folders nest at most ${LIMITS.depth} levels`);
    ws.collections.push(node);
  } else targetFolder(ws, parentId, node).children.push(node);
  ws.updatedAt = Date.now();
}

export function removeNode(ws: Workspace, id: string): TreeNode | null {
  const at = locate(ws.collections, id);
  if (!at) return null;
  ws.updatedAt = Date.now();
  return at.list.splice(at.index, 1)[0] ?? null;
}

/** Moves a node into another folder (append) or by `offset` within its own list. */
export function moveNode(ws: Workspace, id: string, to: { parentId: string } | { offset: number }): void {
  const at = locate(ws.collections, id);
  const node = at?.list[at.index];
  if (!at || !node) return;
  if ('offset' in to) {
    const j = at.index + to.offset;
    if (j < 0 || j >= at.list.length) return;
    at.list.splice(at.index, 1);
    at.list.splice(j, 0, node);
  } else {
    const parent = targetFolder(ws, to.parentId, node); // validate first: a rejected move must not lose the node
    at.list.splice(at.index, 1);
    parent.children.push(node);
  }
  ws.updatedAt = Date.now();
}

const copyFolder = (f: FolderNode): FolderNode => ({ ...f, id: newId(), children: f.children.map(withNewIds) });
const withNewIds = (n: TreeNode): TreeNode => (n.kind === 'folder' ? copyFolder(n) : { ...n, id: newId() });

/** Deep copy with fresh ids, placed right after the original. */
export function duplicateNode(ws: Workspace, id: string): TreeNode | null {
  const at = locate(ws.collections, id);
  const node = at?.list[at.index];
  if (!at || !node) return null;
  const copy = withNewIds({ ...node, name: `${node.name} copy` });
  if (countNodes(ws.collections) + countNodes([copy]) > LIMITS.nodes)
    throw new ImportError(`Workspaces hold at most ${LIMITS.nodes} items`);
  at.list.splice(at.index + 1, 0, copy);
  ws.updatedAt = Date.now();
  return copy;
}

export function duplicateWorkspace(ws: Workspace): Workspace {
  const now = Date.now();
  return { ...ws, id: newId(), name: `${ws.name} copy`, createdAt: now, updatedAt: now, collections: ws.collections.map(copyFolder) };
}

export function envVars(ws: Workspace | null): Record<string, string> {
  const env = ws?.envs.find((e) => e.id === ws.activeEnvId);
  return Object.fromEntries((env?.vars ?? []).filter((x) => x.key).map((x) => [x.key, x.value]));
}
