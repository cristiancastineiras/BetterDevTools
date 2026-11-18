import { formatBytes } from '@betterdevtools/core';
import { createEffect, createMemo, Match, onSettled, Show, Switch } from 'solid-js';
import CollectionsView from './components/CollectionsView.tsx';
import CommandPalette, { type Command } from './components/CommandPalette.tsx';
import CompareDialog from './components/CompareDialog.tsx';
import ConfirmDialog from './components/ConfirmDialog.tsx';
import ContextMenu from './components/ContextMenu.tsx';
import ExportDialog from './components/ExportDialog.tsx';
import NetworkView from './components/NetworkView.tsx';
import ReplayView from './components/ReplayView.tsx';
import SaveDialog from './components/SaveDialog.tsx';
import SettingsPanel, { setLanguage, setTheme } from './components/SettingsPanel.tsx';
import Tabs from './components/Tabs.tsx';
import IconButton from './components/ui/IconButton.tsx';
import { formatNumber, t } from './i18n/index.ts';
import { curlOf, saveToCollection, toggleRecordingWithNotice } from './state/actions.ts';
import {
  activeRequest,
  activeRequestId,
  applyCaptureLimits,
  attachedToDevtools,
  bodiesVersion,
  capturedCount,
  captureLog,
  clearRequests,
  filterDurationMs,
  isRecording,
  malformedCount,
  selectAllVisible,
  selectedCount,
  setActiveRequestId,
  startDevtoolsCapture,
  visibleRequests,
} from './state/capture.ts';
import { importFile } from './state/import.ts';
import { loadPreferences, onPreferencesSaveError, preferences } from './state/preferences.ts';
import { loadReplayHistory, openReplay } from './state/replay.ts';
import {
  copyToClipboard,
  currentView,
  errorMessage,
  reportError,
  setCurrentView,
  setErrorMessage,
  showDialog,
  statusMessage,
  type View,
} from './state/ui.ts';
import { loadWorkspaces } from './state/workspaces.ts';

/** Capture starts after the preferences load, but never waits longer than this for storage. */
const STORAGE_WAIT_MS = 1500;

const VIEW_SHORTCUTS = new Map<string, View>([
  ['Digit1', 'network'],
  ['Digit2', 'replay'],
  ['Digit3', 'collections'],
]);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Loads what is stored and starts capturing. Storage problems are reported, never blocking. */
async function initialize(): Promise<void> {
  onPreferencesSaveError((error) => reportError(t('status.saveSettingsFailed'), error));
  const preferencesLoaded = loadPreferences().then(
    () => applyCaptureLimits(),
    (error: unknown) => reportError(t('status.storageUnavailable'), error),
  );
  await Promise.race([preferencesLoaded, delay(STORAGE_WAIT_MS)]);
  applyCaptureLimits();
  startDevtoolsCapture();
  try {
    await Promise.all([loadWorkspaces(), loadReplayHistory()]);
  } catch (error) {
    reportError(t('status.storageUnavailable'), error);
  }
}

function openExport() {
  showDialog({ kind: 'export', scope: selectedCount() ? 'selected' : 'filtered' });
}

function onFileChosen(event: Event & { currentTarget: HTMLInputElement }) {
  const file = event.currentTarget.files?.[0];
  if (file) void importFile(file);
  event.currentTarget.value = ''; // choosing the same file again still triggers a change
}

/** The panel: view tabs, the current view, the footer, and the dialogs shared by all views. */
export default function App() {
  let filterInput: HTMLInputElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  const chooseImportFile = () => fileInput?.click();
  function focusFilter() {
    setCurrentView('network');
    queueMicrotask(() => filterInput?.focus());
  }

  function commands(): Command[] {
    const active = activeRequest();
    return [
      { label: isRecording() ? t('palette.pause') : t('palette.resume'), keys: 'Ctrl+E', run: toggleRecordingWithNotice },
      { label: t('palette.clear'), keys: 'Ctrl+L', run: clearRequests },
      { label: t('palette.focusFilter'), keys: 'Ctrl+F', run: focusFilter },
      { label: t('palette.selectAll'), keys: 'Ctrl+A', run: selectAllVisible },
      { label: t('palette.export'), keys: 'Ctrl+Shift+E', run: openExport },
      { label: t('palette.import'), keys: 'Ctrl+O', run: chooseImportFile },
      { label: t('palette.replayActive'), keys: 'R', disabled: !active, run: () => active && openReplay(active) },
      { label: t('palette.copyActiveUrl'), disabled: !active, run: () => active && void copyToClipboard(active.url, 'URL') },
      { label: t('palette.copyActiveCurl'), disabled: !active, run: () => active && void copyToClipboard(curlOf(active), 'cURL') },
      { label: t('palette.saveActive'), disabled: !active, run: () => active && saveToCollection(active) },
      { label: t('palette.goNetwork'), keys: 'Alt+1', run: () => setCurrentView('network') },
      { label: t('palette.goReplay'), keys: 'Alt+2', run: () => setCurrentView('replay') },
      { label: t('palette.goCollections'), keys: 'Alt+3', run: () => setCurrentView('collections') },
      { label: t('palette.settings'), run: () => showDialog({ kind: 'settings' }) },
      { label: t('palette.themeSystem'), run: () => setTheme('system') },
      { label: t('palette.themeLight'), run: () => setTheme('light') },
      { label: t('palette.themeDark'), run: () => setTheme('dark') },
      { label: t('palette.languageEnglish'), run: () => setLanguage('en') },
      { label: t('palette.languageSpanish'), run: () => setLanguage('es') },
    ];
  }

  /** Panel-wide shortcuts; keys typed into fields, menus and dialogs are left alone. */
  function onKeyDown(event: KeyboardEvent) {
    const target = event.target;
    // already handled inside (e.g. Ctrl+F in a body viewer), or typed in a menu or dialog
    if (event.defaultPrevented || (target instanceof Element && target.closest('[popover], dialog'))) return;
    const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const withModifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const view = event.altKey ? VIEW_SHORTCUTS.get(event.code) : undefined;
    const active = activeRequest();
    let action: (() => void) | undefined;
    if (withModifier && (key === 'k' || (event.shiftKey && key === 'p'))) action = () => showDialog({ kind: 'palette' });
    else if (withModifier && event.shiftKey && key === 'e') action = openExport;
    else if (withModifier && key === 'e') action = toggleRecordingWithNotice;
    else if (withModifier && key === 'l') action = clearRequests;
    else if (withModifier && key === 'f') action = focusFilter;
    else if (withModifier && key === 'o') action = chooseImportFile;
    else if (view) action = () => setCurrentView(view);
    else if (!typing && !withModifier && event.key === '/') action = focusFilter;
    else if (!typing && !withModifier && key === 'r' && currentView() === 'network' && active) action = () => openReplay(active);
    else if (!typing && event.key === 'Escape' && currentView() === 'network' && activeRequestId() !== null)
      action = () => setActiveRequestId(null);
    if (action) {
      event.preventDefault();
      action();
    }
  }

  onSettled(() => {
    void initialize();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // "system" lets the browser pick light or dark; the tokens in app.css follow color-scheme
  createEffect(
    () => preferences.theme,
    (theme) => {
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'system' ? 'light dark' : theme);
    },
  );

  const bodyMemory = createMemo(() => {
    bodiesVersion();
    return formatBytes(captureLog.bodyChars * 2);
  });

  return (
    <>
      <div class="flex h-full flex-col">
        <Show when={errorMessage()}>
          <div role="alert" class="flex items-center gap-2 border-b border-bad bg-bad/10 px-2 py-1 text-bad">
            <span class="flex-1">{errorMessage()}</span>
            <IconButton icon="close" variant="ghost" label={t('app.dismissError')} onClick={() => setErrorMessage('')} />
          </div>
        </Show>

        <main class="min-h-0 flex-1">
          <Tabs
            label={t('app.viewsLabel')}
            value={currentView()}
            onChange={setCurrentView}
            panelClass="overflow-hidden"
            tabs={[
              { id: 'network', label: t('app.views.network') },
              { id: 'replay', label: t('app.views.replay') },
              { id: 'collections', label: t('app.views.collections') },
            ]}
            end={
              <>
                <IconButton
                  icon="command"
                  label={t('app.commandPalette')}
                  text={t('app.commands')}
                  onClick={() => showDialog({ kind: 'palette' })}
                />
                <IconButton icon="settings" label={t('app.settings')} onClick={() => showDialog({ kind: 'settings' })} />
              </>
            }
          >
            <Switch>
              <Match when={currentView() === 'network'}>
                <NetworkView onFilterInput={(input) => (filterInput = input)} onImport={chooseImportFile} />
              </Match>
              <Match when={currentView() === 'replay'}>
                <ReplayView />
              </Match>
              <Match when={currentView() === 'collections'}>
                <CollectionsView onImport={chooseImportFile} />
              </Match>
            </Switch>
          </Tabs>
        </main>

        <footer class="flex flex-wrap items-center gap-x-3 border-t border-line bg-bg-2 px-2 py-0.5 text-fg-2">
          <span>{t('footer.requests', { shown: formatNumber(visibleRequests().length), total: formatNumber(capturedCount()) })}</span>
          <Show when={selectedCount()}>
            <span>{t('footer.selected', { count: formatNumber(selectedCount()) })}</span>
          </Show>
          <span>{t('footer.filterTime', { ms: filterDurationMs() })}</span>
          <span>{t('footer.bodyMemory', { size: bodyMemory() })}</span>
          <Show when={malformedCount()}>
            <span class="text-warn">{t('footer.malformed', { count: formatNumber(malformedCount()) })}</span>
          </Show>
          <Show when={!attachedToDevtools}>
            <span class="text-warn">{t('footer.notAttached')}</span>
          </Show>
          <span role="status" class="ms-auto text-fg">
            {statusMessage()}
          </span>
        </footer>
      </div>

      <input
        ref={(element) => (fileInput = element)}
        type="file"
        accept=".har,.json,application/json"
        class="sr-only"
        tabindex="-1"
        aria-label={t('app.importFileLabel')}
        onChange={onFileChosen}
      />
      <ContextMenu />
      <CommandPalette commands={commands} />
      <ExportDialog />
      <SettingsPanel />
      <SaveDialog />
      <CompareDialog />
      <ConfirmDialog />
    </>
  );
}
