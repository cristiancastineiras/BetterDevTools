// Importing files: a HAR goes into the capture list, a workspace file becomes a new workspace.
// Files are untrusted input: they are parsed and validated first, and nothing in them is sent.
import { MAX_IMPORT_BYTES, parseHar, parseWorkspaceFile } from '@betterdevtools/core';
import { snapshot } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { readFile } from '../lib/io.ts';
import { addImportedEntries } from './capture.ts';
import { preferences } from './preferences.ts';
import { announce, reportError, setCurrentView } from './ui.ts';
import { addWorkspace } from './workspaces.ts';

const WORKSPACE_MARKER = /"format"\s*:\s*"betterdevtools\.workspace"/;

export async function importFile(file: File): Promise<void> {
  try {
    const text = await readFile(file, MAX_IMPORT_BYTES);
    if (WORKSPACE_MARKER.test(text.slice(0, 200))) {
      const workspace = parseWorkspaceFile(text);
      await addWorkspace(workspace);
      setCurrentView('collections');
      announce(t('status.importedWorkspace', { name: workspace.name }));
      return;
    }
    const { entries, skipped } = parseHar(text);
    addImportedEntries(entries);
    setCurrentView('network');
    const count = formatNumber(entries.length);
    const message = skipped ? t('status.importedSkipped', { count, skipped: formatNumber(skipped) }) : t('status.imported', { count });
    const kept = Math.min(entries.length, snapshot(preferences).capacity);
    announce(kept < entries.length ? `${message}; ${t('status.importedCapped', { kept: formatNumber(kept) })}` : message);
  } catch (error) {
    reportError(t('status.importFailed', { file: file.name }), error);
  }
}
