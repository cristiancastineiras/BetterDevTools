import { describe, expect, it } from 'vitest';
import {
  countNodes,
  createWorkspace,
  duplicateNode,
  envVars,
  findNode,
  ImportError,
  insertNode,
  LIMITS,
  migrate,
  moveNode,
  parseWorkspaceFile,
  readWorkspace,
  removeNode,
  workspaceFile,
  type FolderNode,
  type Migration,
} from '../src/index.ts';

const folder = (name: string, children: FolderNode['children'] = []): FolderNode => ({
  kind: 'folder',
  id: crypto.randomUUID(),
  name,
  children,
});
const request = (name: string) => ({
  kind: 'request' as const,
  id: crypto.randomUUID(),
  name,
  method: 'GET',
  url: 'https://x.test',
  query: '',
  headers: '',
  body: '',
});

describe('workspace files', () => {
  it('round-trip through export and import with a new id', () => {
    const ws = createWorkspace('Team');
    ws.envs[0]!.vars.push({ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'https://x.test', secret: false });
    insertNode(ws, ws.collections[0]!.id, request('List'));
    const imported = parseWorkspaceFile(workspaceFile(ws, false));
    expect(imported.id).not.toBe(ws.id);
    expect(imported.name).toBe('Team (imported)');
    expect(imported.envs[0]!.vars).toEqual([
      { key: 'token', value: '', secret: true },
      { key: 'base', value: 'https://x.test', secret: false },
    ]);
    expect(parseWorkspaceFile(workspaceFile(ws, true)).envs[0]!.vars[0]!.value).toBe('s3cret');
    expect(countNodes(imported.collections)).toBe(2);
  });

  it.each([
    ['not JSON', '{oops'],
    ['wrong format', '{"format":"other"}'],
    ['missing fields', '{"format":"betterdevtools.workspace","workspace":{"schemaVersion":1,"id":"a"}}'],
    ['newer schema', JSON.stringify({ format: 'betterdevtools.workspace', workspace: { ...createWorkspace('x'), schemaVersion: 99 } })],
    [
      'deep nesting',
      JSON.stringify({
        format: 'betterdevtools.workspace',
        workspace: { ...createWorkspace('x'), collections: [JSON.parse('{"a":'.repeat(60) + '1' + '}'.repeat(60))] },
      }),
    ],
  ])('rejects %s with an ImportError', (_name, text) => {
    expect(() => parseWorkspaceFile(text)).toThrow(ImportError);
  });

  it('treats corrupt stored records as unreadable instead of crashing', () => {
    expect(readWorkspace({ schemaVersion: 1, id: 'x' })).toBeNull();
    expect(readWorkspace('garbage')).toBeNull();
    const ws = createWorkspace('ok');
    expect(readWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });
});

describe('migrations', () => {
  const addColor: Migration = {
    from: 1,
    up: (d) => ({ ...d, color: 'teal' }),
    down: ({ color: _color, ...rest }) => rest,
  };

  it('are reversible step by step', () => {
    const v1 = { ...createWorkspace('m') };
    const v2 = migrate(v1, 2, [addColor]);
    expect(v2).toMatchObject({ schemaVersion: 2, color: 'teal' });
    expect(migrate(v2, 1, [addColor])).toEqual(v1);
  });

  it('refuse unknown versions instead of guessing', () => {
    expect(() => migrate({ schemaVersion: 3 }, 1, [addColor])).toThrow(/newer/);
    expect(() => migrate({}, 1)).toThrow(/schemaVersion/);
  });
});

describe('collections tree', () => {
  it('moves, reorders, duplicates and removes nodes', () => {
    const ws = createWorkspace('t');
    const root = ws.collections[0]!;
    const sub = folder('sub');
    const a = request('a');
    const b = request('b');
    insertNode(ws, root.id, a);
    insertNode(ws, root.id, b);
    insertNode(ws, root.id, sub);
    moveNode(ws, b.id, { offset: -1 });
    expect(root.children.map((n) => n.name)).toEqual(['b', 'a', 'sub']);
    moveNode(ws, a.id, { parentId: sub.id });
    expect(sub.children.map((n) => n.name)).toEqual(['a']);
    expect(() => moveNode(ws, root.id, { parentId: sub.id })).toThrow(/into itself/);
    const copy = duplicateNode(ws, sub.id);
    expect(copy?.id).not.toBe(sub.id);
    expect(copy?.kind === 'folder' && copy.children[0]?.id).not.toBe(a.id);
    expect(removeNode(ws, b.id)?.name).toBe('b');
    expect(findNode(ws.collections, b.id)).toBeNull();
  });

  it('enforces size and depth limits', () => {
    const ws = createWorkspace('t');
    let parent = ws.collections[0]!;
    for (let d = 1; d < LIMITS.depth; d++) {
      const f = folder(`d${d}`);
      insertNode(ws, parent.id, f);
      parent = f;
    }
    expect(() => insertNode(ws, parent.id, folder('too deep'))).toThrow(/nest/);
    expect(() => insertNode(ws, null, request('loose'))).toThrow(/collection/);
    insertNode(ws, parent.id, request('leaf at the deepest level')); // requests add no folder level
  });

  it('rejects a move that breaks a limit without losing the moved node', () => {
    const ws = createWorkspace('t');
    let deep = ws.collections[0]!;
    for (let d = 1; d < LIMITS.depth - 1; d++) {
      const f = folder(`d${d}`);
      insertNode(ws, deep.id, f);
      deep = f;
    }
    const tall = folder('tall', [folder('child', [folder('grandchild')])]);
    insertNode(ws, null, tall);
    expect(() => moveNode(ws, tall.id, { parentId: deep.id })).toThrow(/nest/);
    expect(() => moveNode(ws, tall.id, { parentId: 'missing' })).toThrow(/not found/);
    expect(findNode(ws.collections, tall.id)).toBe(tall);
    expect(() => insertNode(ws, deep.id, folder('copy', [folder('x', [folder('y')])]))).toThrow(/nest/);
  });

  it('exposes the active environment as variables', () => {
    const ws = createWorkspace('t');
    ws.envs[0]!.vars.push({ key: 'base', value: 'https://a.test', secret: false }, { key: '', value: 'ignored', secret: false });
    expect(envVars(ws)).toEqual({ base: 'https://a.test' });
    expect(envVars(null)).toEqual({});
  });
});
