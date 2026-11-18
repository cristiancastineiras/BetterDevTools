import { formatBytes } from '@betterdevtools/core';
import { createMemo, createSignal, createUniqueId, For, Match, Show, snapshot, Switch } from 'solid-js';
import * as v from 'valibot';
import { applyLocale, t, type LocalePreference } from '../i18n/index.ts';
import { extensionVersion } from '../lib/devtools.ts';
import { applyCaptureLimits, bodiesVersion, captureLog, refilter } from '../state/capture.ts';
import { preferences, PreferencesSchema, updatePreferences, type Preferences } from '../state/preferences.ts';
import { announce, closeDialog, openDialog } from '../state/ui.ts';
import IconButton from './ui/IconButton.tsx';
import Modal from './ui/Modal.tsx';
import SegmentedControl from './ui/SegmentedControl.tsx';
import { buttonClass, fieldClass, monoClass, sectionTitleClass } from './ui/styles.ts';

type Section = 'general' | 'capture' | 'shortcuts' | 'privacy';
const SECTIONS: Section[] = ['general', 'capture', 'shortcuts', 'privacy'];

type ShortcutKey =
  | 'palette'
  | 'record'
  | 'clear'
  | 'filter'
  | 'import'
  | 'export'
  | 'views'
  | 'replay'
  | 'close'
  | 'send'
  | 'menu'
  | 'select';
const SHORTCUTS: { keys: string; action: ShortcutKey }[] = [
  { keys: 'Ctrl+K', action: 'palette' },
  { keys: 'Ctrl+E', action: 'record' },
  { keys: 'Ctrl+L', action: 'clear' },
  { keys: 'Ctrl+F · /', action: 'filter' },
  { keys: 'Ctrl+O', action: 'import' },
  { keys: 'Ctrl+Shift+E', action: 'export' },
  { keys: 'Alt+1 · Alt+2 · Alt+3', action: 'views' },
  { keys: 'R', action: 'replay' },
  { keys: 'Esc', action: 'close' },
  { keys: 'Ctrl+Enter', action: 'send' },
  { keys: 'Shift+F10', action: 'menu' },
  { keys: '↑ ↓ · Shift · Ctrl · Space', action: 'select' },
];

// "System (dark)" shows the current system theme, kept up to date
const systemDarkQuery = matchMedia('(prefers-color-scheme: dark)');
const [systemIsDark, setSystemIsDark] = createSignal(systemDarkQuery.matches);
systemDarkQuery.addEventListener('change', (event) => setSystemIsDark(event.matches));

function bodyMemoryInUse(): string {
  bodiesVersion();
  return formatBytes(captureLog.bodyChars * 2);
}

/** A labelled number input with its unit, for the capture limits. */
function NumberField(props: { label: string; unit: string; min: number; max: number; value: number; onInput: (value: number) => void }) {
  return (
    <label class="flex items-center justify-between gap-2">
      {props.label}
      <span class="flex items-center gap-1">
        <input
          class={[fieldClass, 'w-28 text-end']}
          type="number"
          min={props.min}
          max={props.max}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.valueAsNumber)}
        />
        <span class="w-16 text-fg-2">{props.unit}</span>
      </span>
    </label>
  );
}

export function setTheme(theme: Preferences['theme']): void {
  updatePreferences((draft) => {
    draft.theme = theme;
  });
}

export function setLanguage(locale: LocalePreference): void {
  updatePreferences((draft) => {
    draft.locale = locale;
  });
  applyLocale(locale);
}

/** Settings in a large dialog with a section list: general, capture, shortcuts and privacy. */
export default function SettingsPanel() {
  const titleId = createUniqueId();
  const isOpen = createMemo(() => openDialog()?.kind === 'settings');
  const [section, setSection] = createSignal<Section>('general');

  // capture limits are edited here and only applied with "Apply limits"
  const [capacity, setCapacity] = createSignal(0);
  const [maxBodyKB, setMaxBodyKB] = createSignal(0);
  const [bodyBudgetMB, setBodyBudgetMB] = createSignal(0);
  const [limitsError, setLimitsError] = createSignal('');

  function prepare() {
    const current = snapshot(preferences);
    setCapacity(current.capacity);
    setMaxBodyKB(current.maxBodyKB);
    setBodyBudgetMB(current.bodyBudgetMB);
    setLimitsError('');
  }

  function applyLimits(event: SubmitEvent) {
    event.preventDefault();
    const next = { ...snapshot(preferences), capacity: capacity(), maxBodyKB: maxBodyKB(), bodyBudgetMB: bodyBudgetMB() };
    const result = v.safeParse(PreferencesSchema, next);
    if (!result.success) {
      setLimitsError(result.issues.map((issue) => `${String(issue.path?.[0]?.key ?? '')}: ${issue.message}`).join('; '));
      return;
    }
    setLimitsError('');
    updatePreferences((draft) => {
      draft.capacity = result.output.capacity;
      draft.maxBodyKB = result.output.maxBodyKB;
      draft.bodyBudgetMB = result.output.bodyBudgetMB;
    });
    applyCaptureLimits();
    announce(t('settings.limitsApplied'));
  }

  return (
    <Modal
      open={isOpen()}
      onOpen={prepare}
      onDismiss={closeDialog}
      labelledBy={titleId}
      class="h-[min(36rem,calc(100vh-2rem))] w-[min(56rem,calc(100vw-2rem))] max-w-none"
    >
      <div class="flex h-full flex-col">
        <header class="flex items-center gap-2 border-b border-line px-4 py-2">
          <h2 id={titleId} class="flex-1 text-base font-semibold">
            {t('settings.title')}
          </h2>
          <IconButton icon="close" variant="ghost" label={t('common.close')} onClick={closeDialog} />
        </header>
        <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t('settings.sectionsLabel')} class="flex shrink-0 gap-1 border-line p-2 sm:w-48 sm:flex-col sm:border-e">
            <For each={SECTIONS}>
              {(item) => (
                <button
                  type="button"
                  class={[
                    'cursor-pointer rounded-md px-3 py-1.5 text-start',
                    section() === item ? 'bg-sel font-semibold text-fg' : 'text-fg-2 hover:bg-bg-3 hover:text-fg',
                  ]}
                  aria-current={section() === item ? 'page' : undefined}
                  onClick={() => setSection(item)}
                >
                  {t(`settings.sections.${item}`)}
                </button>
              )}
            </For>
          </nav>

          <div class="min-h-0 flex-1 overflow-auto p-4">
            <Switch>
              <Match when={section() === 'general'}>
                <div class="flex flex-col gap-4">
                  <div class="flex flex-col gap-1">
                    <span class={sectionTitleClass}>{t('settings.language')}</span>
                    <SegmentedControl
                      label={t('settings.language')}
                      value={preferences.locale}
                      onChange={setLanguage}
                      options={[
                        { value: 'auto', label: t('settings.languages.auto') },
                        { value: 'en', label: t('settings.languages.en') },
                        { value: 'es', label: t('settings.languages.es') },
                      ]}
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class={sectionTitleClass}>{t('settings.theme')}</span>
                    <SegmentedControl
                      label={t('settings.theme')}
                      value={preferences.theme}
                      onChange={setTheme}
                      options={[
                        {
                          value: 'system',
                          label: t('settings.themes.system', {
                            current: systemIsDark() ? t('settings.themeCurrentDark') : t('settings.themeCurrentLight'),
                          }),
                          title: t('settings.themeSystemTitle'),
                        },
                        { value: 'light', label: t('settings.themes.light') },
                        { value: 'dark', label: t('settings.themes.dark') },
                      ]}
                    />
                  </div>
                </div>
              </Match>

              <Match when={section() === 'capture'}>
                <form class="flex max-w-lg flex-col gap-2" onSubmit={applyLimits}>
                  <label class="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={preferences.preserveLog}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        updatePreferences((draft) => {
                          draft.preserveLog = checked;
                        });
                      }}
                    />
                    {t('settings.preserveLog')}
                  </label>
                  <label class="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={preferences.searchBodies}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        updatePreferences((draft) => {
                          draft.searchBodies = checked;
                        });
                        refilter();
                      }}
                    />
                    {t('network.searchBodies')}
                  </label>
                  <NumberField
                    label={t('settings.keepAtMost')}
                    unit={t('settings.requestsUnit')}
                    min={100}
                    max={100_000}
                    value={capacity()}
                    onInput={setCapacity}
                  />
                  <NumberField
                    label={t('settings.cutBody')}
                    unit={t('settings.kbUnit')}
                    min={16}
                    max={51_200}
                    value={maxBodyKB()}
                    onInput={setMaxBodyKB}
                  />
                  <NumberField
                    label={t('settings.bodyMemory')}
                    unit={t('settings.mbUnit')}
                    min={8}
                    max={2048}
                    value={bodyBudgetMB()}
                    onInput={setBodyBudgetMB}
                  />
                  <p class="text-fg-2">{t('settings.inUse', { size: bodyMemoryInUse() })}</p>
                  <Show when={limitsError()}>
                    <p class="text-bad" role="alert">
                      {limitsError()}
                    </p>
                  </Show>
                  <div>
                    <button type="submit" class={buttonClass('primary')}>
                      {t('settings.applyLimits')}
                    </button>
                  </div>
                </form>
              </Match>

              <Match when={section() === 'shortcuts'}>
                <p class="mb-2 text-fg-2">{t('settings.shortcutsIntro')}</p>
                <table class="w-full max-w-xl border-collapse">
                  <tbody>
                    <For each={SHORTCUTS}>
                      {(shortcut) => (
                        <tr class="border-b border-bg-3">
                          <td class="py-1 pe-4">{t(`settings.shortcuts.${shortcut.action}`)}</td>
                          <td class="py-1">
                            <kbd class={[monoClass, 'rounded-sm border border-line bg-bg-2 px-1']}>{shortcut.keys}</kbd>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Match>

              <Match when={section() === 'privacy'}>
                <p class="max-w-xl">{t('settings.privacyText')}</p>
                <p class="mt-4 text-fg-2">{t('settings.version', { version: extensionVersion() })}</p>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Modal>
  );
}
