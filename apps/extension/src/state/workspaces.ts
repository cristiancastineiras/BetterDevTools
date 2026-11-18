// Workspaces (collections, folders, saved requests, environments), persisted in IndexedDB.
// Every change goes through editWorkspace(), which applies it and saves the result.
import { createWorkspace, readWorkspace, type Workspace } from '@betterdevtools/core';
import { createStore, flush, snapshot } from 'solid-js';
import { t } from '../i18n/index.ts';
import { db } from '../lib/db.ts';
import { logEvent } from '../lib/io.ts';
import { preferences, updatePreferences } from './preferences.ts';
import { reportError } from './ui.ts';

export const [workspaces, setWorkspacesStore] = createStore<Workspace[]>([]);

/** The workspace selected in the preferences, or the first one. Reactive. */
export function activeWorkspace(): Workspace | null {
  return workspaces.find((w) => w.id === preferences.workspaceId) ?? workspaces[0] ?? null;
}

/** Loads stored workspaces (invalid records are skipped, never repaired) and makes sure one exists. */
export async function loadWorkspaces(): Promise<void> {
  const stored = await db.all('workspaces');
  const valid = stored.map(readWorkspace).filter((w): w is Workspace => w !== null);
  if (valid.length < stored.length) logEvent('warn', 'workspaces.skipped', { count: stored.length - valid.length });
  if (!valid.length) {
    const first = createWorkspace(t('collections.defaultWorkspace'));
    await db.put('workspaces', first);
    valid.push(first);
  }
  setWorkspacesStore(() => valid);
}

async function persist(workspaceId: string): Promise<void> {
  flush(); // store writes become readable after a flush
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;
  try {
    await db.put('workspaces', snapshot(workspace));
  } catch (error) {
    reportError(t('status.saveWorkspaceFailed'), error);
  }
}

// Typing in a field saves once the typing pauses instead of on every key.
const TYPING_SAVE_DELAY_MS = 300;
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(workspaceId: string, delayMs: number): void {
  clearTimeout(pendingSaves.get(workspaceId));
  if (!delayMs) {
    pendingSaves.delete(workspaceId);
    void persist(workspaceId);
    return;
  }
  pendingSaves.set(
    workspaceId,
    setTimeout(() => {
      pendingSaves.delete(workspaceId);
      void persist(workspaceId);
    }, delayMs),
  );
}

/**
 * Applies `change` to the active workspace and saves it (after a short pause with `typing`).
 * Core tree operations validate before they mutate, so a rejected change (limit, invalid move)
 * leaves the workspace untouched.
 */
export function editWorkspace(change: (workspace: Workspace) => void, options: { typing?: boolean } = {}): boolean {
  const target = activeWorkspace();
  if (!target) return false;
  const targetId = target.id;
  try {
    setWorkspacesStore((list) => {
      const workspace = list.find((w) => w.id === targetId);
      if (workspace) change(workspace);
    });
  } catch (error) {
    reportError(t('status.changeRejected'), error);
    return false;
  }
  scheduleSave(targetId, options.typing ? TYPING_SAVE_DELAY_MS : 0);
  return true;
}

export function selectWorkspace(id: string): void {
  updatePreferences((p) => {
    p.workspaceId = id;
  });
}

export async function addWorkspace(workspace: Workspace): Promise<void> {
  try {
    await db.put('workspaces', workspace);
    setWorkspacesStore((list) => {
      list.push(workspace);
    });
    selectWorkspace(workspace.id);
  } catch (error) {
    reportError(t('collections.createFailed'), error);
  }
}

export async function deleteWorkspace(id: string): Promise<void> {
  try {
    await db.delete('workspaces', id);
    setWorkspacesStore((list) => list.filter((w) => w.id !== id));
    flush();
    if (!workspaces.length) await addWorkspace(createWorkspace(t('collections.defaultWorkspace')));
    flush();
    selectWorkspace(workspaces[0]?.id ?? '');
  } catch (error) {
    reportError(t('collections.deleteFailed'), error);
  }
}
