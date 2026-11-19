// Actions on captured requests shared by the request list menu, the details header and the
// command palette, so every entry point behaves the same.
import { buildRequest, DEFAULT_EXPORT, draftFromEntry, exportRecord, toCurl, type Captured } from '@betterdevtools/core';
import { createSignal } from 'solid-js';
import { t } from '../i18n/index.ts';
import { setCacheDisabled } from '../lib/devtools.ts';
import { captureLog, selectAllVisible, selectedRequests, toggleRecording } from './capture.ts';
import { openReplay } from './replay.ts';
import { announce, copyToClipboard, openContextMenu, reportError, showDialog } from './ui.ts';

/** Pauses or resumes recording and says so in the status line. */
export function toggleRecordingWithNotice(): void {
  announce(toggleRecording() ? t('status.recording') : t('status.paused'));
}

/** cURL command for a captured request; credentials (cookies, Authorization) are left out. */
export function curlOf(request: Captured): string {
  const built = buildRequest(draftFromEntry(request.har), {});
  return 'request' in built ? toCurl(built.request) : `# ${built.error}`;
}

/** The request as one HAR entry with secrets redacted. */
export function harEntryOf(request: Captured): string {
  return JSON.stringify(exportRecord(request, captureLog.body(request.id), DEFAULT_EXPORT), null, 2);
}

export function saveToCollection(request: Captured): void {
  const { method, url, query, headers, body } = draftFromEntry(request.har, request.id);
  showDialog({ kind: 'save', request: { method, url, query, headers, body } });
}

/** Opens the actions menu for the selected requests (or the active one) at a pointer position. */
export function openRequestMenu(at: { clientX: number; clientY: number }): void {
  const requests = selectedRequests();
  const [first, second] = requests;
  const single = requests.length === 1 ? first : undefined;
  openContextMenu(at, t('menu.requestActions'), [
    { label: t('menu.replay'), disabled: !single, run: () => single && openReplay(single) },
    {
      label: requests.length > 1 ? t('menu.copyUrls', { count: requests.length }) : t('menu.copyUrl'),
      disabled: !requests.length,
      run: () => void copyToClipboard(requests.map((request) => request.url).join('\n'), 'URL'),
    },
    {
      label: t('menu.copyCurl'),
      disabled: !requests.length,
      run: () => void copyToClipboard(requests.map(curlOf).join('\n\n'), 'cURL'),
    },
    { label: t('menu.copyHar'), disabled: !single, run: () => single && void copyToClipboard(harEntryOf(single), 'HAR') },
    {
      label: t('menu.compare'),
      disabled: requests.length !== 2,
      run: () => first && second && showDialog({ kind: 'compare', first, second }),
    },
    { label: t('menu.saveToCollection'), disabled: !single, run: () => single && saveToCollection(single) },
    {
      label: t('menu.exportSelected', { count: requests.length }),
      disabled: !requests.length,
      run: () => showDialog({ kind: 'export', scope: 'selected' }),
    },
    { label: t('menu.selectAll'), run: selectAllVisible },
  ]);
}

// ------------------------------------------------------------------------------ disable cache

const [cacheDisabledSignal, setCacheDisabledSignal] = createSignal(false);
export const cacheDisabled = cacheDisabledSignal;

/** Switches "disable cache" for the inspected tab; the rule is removed again when the panel closes. */
export async function toggleDisableCache(): Promise<void> {
  const next = !cacheDisabledSignal();
  const problem = await setCacheDisabled(next);
  if (problem) {
    reportError(t('status.cacheFailed', { reason: problem }));
    return;
  }
  setCacheDisabledSignal(next);
  announce(next ? t('status.cacheOff') : t('status.cacheOn'));
}

/** Removes a rule left behind by an earlier panel session, and this one's when the panel closes. */
export function releaseCacheRuleOnClose(): void {
  void setCacheDisabled(false);
  addEventListener('pagehide', () => void setCacheDisabled(false));
}
