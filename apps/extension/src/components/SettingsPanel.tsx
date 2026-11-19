import { formatBytes } from '@betterdevtools/core';
import { createMemo, createSignal, createUniqueId, For, Match, Show, snapshot, Switch } from 'solid-js';
import * as v from 'valibot';
import { applyLocale, t, type LocalePreference } from '../i18n/index.ts';
import { extensionVersion } from '../lib/devtools.ts';
import { applyCaptureLimits, bodiesVersion, captureLog, refilter } from '../state/capture.ts';
import {
  DEFAULT_PREFERENCES,
  PreferenceFields,
  preferences,
  THEME_NAMES,
  THEMES,
  PreferencesSchema,
  updatePreferences,
  type Preferences,
} from '../state/preferences.ts';
import { announce, askConfirmation, closeDialog, openDialog } from '../state/ui.ts';
import IconButton from './ui/IconButton.tsx';
import Modal from './ui/Modal.tsx';
import SegmentedControl from './ui/SegmentedControl.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
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
  { keys: 'Alt+1 … Alt+4', action: 'views' },
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

const SANS_FONTS = ['Segoe UI', 'system-ui', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Roboto', 'Helvetica'];
const MONO_FONTS = ['Cascadia Code', 'Consolas', 'Fira Code', 'Source Code Pro', 'Courier New', 'ui-monospace', 'Menlo'];

const THEME_IDS = Object.keys(THEMES) as (keyof typeof THEMES)[];
const UA_PRESETS = [
  {
    name: 'Chrome · Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
  { name: 'Firefox · Windows', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0' },
  {
    name: 'Chrome · Android',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  },
  {
    name: 'Safari · iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  { name: 'Googlebot', value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  { name: 'curl', value: 'curl/8.5.0' },
];

/** Changes one preference (saved a moment later). */
function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  updatePreferences((draft) => {
    draft[key] = value;
  });
}

/** The user agent sent by replays: the browser's own, a preset, or any text. */
function UserAgentField() {
  const options = createMemo(() => {
    const current = preferences.userAgent;
    return [
      { value: '', label: t('settings.userAgentDefault') },
      ...UA_PRESETS.map((preset) => ({ value: preset.value, label: preset.name, description: preset.value })),
      ...(current && !UA_PRESETS.some((preset) => preset.value === current)
        ? [{ value: current, label: t('settings.userAgentCustom'), description: current }]
        : []),
    ];
  });
  return (
    <div class="flex max-w-lg flex-col gap-1">
      <span class={sectionTitleClass}>{t('settings.userAgent')}</span>
      <SelectMenu
        class="w-56"
        label={t('settings.userAgent')}
        value={preferences.userAgent}
        options={options()}
        onChange={(value) => setPreference('userAgent', value)}
      />
      <input
        class={[fieldClass, monoClass, 'w-full']}
        autocomplete="off"
        spellcheck={false}
        maxlength={300}
        placeholder={t('settings.userAgentPlaceholder')}
        aria-label={t('settings.userAgent')}
        value={preferences.userAgent}
        onInput={(event) => {
          const value = event.currentTarget.value.trim();
          if (v.is(PreferenceFields.entries.userAgent, value)) setPreference('userAgent', value);
        }}
      />
      <p class="text-fg-2">{t('settings.userAgentHint')}</p>
    </div>
  );
}

const ACCENTS = ['#8b5cf6', '#22a35a', '#e0791a', '#e5486b', '#0e9aa7'];

/** One colour button of the accent picker (`color` is what it stores, empty for the default). */
function swatch(color: string, label: string, background: string) {
  return (
    <button
      type="button"
      class="size-6 cursor-pointer rounded-full border border-line aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-fg"
      style={{ background }}
      title={label}
      aria-label={label}
      aria-pressed={preferences.accent.toLowerCase() === color ? 'true' : 'false'}
      onClick={() => setPreference('accent', color)}
    />
  );
}

/** Accent colour: the default blue, a few presets, or any colour from the colour picker. */
function AccentPicker() {
  return (
    <div class="flex flex-wrap items-center gap-2.5" role="group" aria-label={t('settings.accent')}>
      {swatch('', t('settings.accentDefault'), 'light-dark(#0969da, #4493f8)')}
      <For each={ACCENTS}>{(color) => swatch(color, color, color)}</For>
      <label class="flex cursor-pointer items-center gap-1 text-fg-2">
        <input
          type="color"
          class="size-6 cursor-pointer rounded-full border border-line bg-transparent p-0"
          value={preferences.accent || '#0969da'}
          aria-label={t('settings.accentCustom')}
          onInput={(event) => setPreference('accent', event.currentTarget.value)}
        />
        {t('settings.accentCustom')}
      </label>
    </div>
  );
}

/** A slider with its current value, for the font size and weight. */
function RangeField(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onInput: (value: number) => void;
}) {
  return (
    <label class="flex items-center justify-between gap-2">
      {props.label}
      <span class="flex w-56 items-center gap-2">
        <input
          class="min-w-0 flex-1 cursor-pointer"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.valueAsNumber)}
        />
        <span class="w-12 text-end tabular-nums">
          {props.value}
          {props.unit}
        </span>
      </span>
    </label>
  );
}

/** Picks a font (the bundled one, or a common font; one stored earlier stays listed) and its size and weight. */
function FontField(props: {
  label: string;
  field: 'fontSans' | 'fontMono';
  size: 'fontSansSize' | 'fontMonoSize';
  weight: 'fontSansWeight' | 'fontMonoWeight';
  suggestions: string[];
  bundled: string;
}) {
  const options = createMemo(() => {
    const current = preferences[props.field];
    const names = !current || props.suggestions.includes(current) ? props.suggestions : [current, ...props.suggestions];
    return [
      { value: '', label: t('settings.fontDefault', { name: props.bundled }) },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  });

  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        {props.label}
        <SelectMenu
          class="w-56"
          label={props.label}
          value={preferences[props.field]}
          options={options()}
          onChange={(value) => setPreference(props.field, value)}
        />
      </div>
      <RangeField
        label={t('settings.fontSize')}
        min={70}
        max={150}
        step={5}
        unit="%"
        value={preferences[props.size]}
        onInput={(value) => setPreference(props.size, value)}
      />
      <RangeField
        label={t('settings.fontWeight')}
        min={300}
        max={700}
        step={100}
        unit=""
        value={preferences[props.weight]}
        onInput={(value) => setPreference(props.weight, value)}
      />
    </div>
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

  async function resetSettings() {
    const confirmed = await askConfirmation({
      title: t('settings.resetTitle'),
      details: [{ text: t('settings.resetDetail') }],
      confirmLabel: t('settings.reset'),
    });
    if (!confirmed) return;
    const defaults = structuredClone(DEFAULT_PREFERENCES);
    updatePreferences((draft) => {
      // the active workspace is a choice of data, not a setting: it stays
      Object.assign(draft, defaults, { workspaceId: draft.workspaceId });
    });
    applyLocale(preferences.locale);
    applyCaptureLimits();
    refilter();
    prepare(); // the capture limit fields show the new values
    announce(t('settings.resetDone'));
  }

  return (
    <Modal
      open={isOpen()}
      onOpen={prepare}
      onDismiss={closeDialog}
      labelledBy={titleId}
      class="m-0 h-(--vh) max-h-none w-(--vw) max-w-none rounded-none border-0"
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
            <button type="button" class={[buttonClass(), 'sm:mt-auto']} onClick={() => void resetSettings()}>
              {t('settings.reset')}
            </button>
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
                    <SelectMenu
                      class="w-56"
                      label={t('settings.theme')}
                      value={preferences.theme}
                      onChange={(theme) => setTheme(theme as Preferences['theme'])}
                      options={THEME_IDS.map((id) => ({
                        value: id,
                        label:
                          id === 'system'
                            ? t('settings.themes.system', {
                                current: systemIsDark() ? t('settings.themeCurrentDark') : t('settings.themeCurrentLight'),
                              })
                            : (THEME_NAMES[id] ?? t(`settings.themes.${id as 'light' | 'dark'}`)),
                        description: id === 'system' ? t('settings.themeSystemTitle') : t(`settings.themes.${THEMES[id] ?? 'dark'}`),
                      }))}
                    />
                  </div>
                  <UserAgentField />
                  <div class="flex flex-col gap-1">
                    <span class={sectionTitleClass}>{t('settings.accent')}</span>
                    <AccentPicker />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class={sectionTitleClass}>{t('settings.scale')}</span>
                    <SegmentedControl
                      label={t('settings.scale')}
                      value={preferences.uiScale}
                      onChange={(uiScale) =>
                        updatePreferences((draft) => {
                          draft.uiScale = uiScale;
                        })
                      }
                      options={(['compact', 'default', 'large', 'xlarge'] as const).map((value) => ({
                        value,
                        label: t(`settings.scales.${value}`),
                      }))}
                    />
                  </div>
                  <div class="flex max-w-lg flex-col gap-4">
                    <span class={sectionTitleClass}>{t('settings.fonts')}</span>
                    <FontField
                      label={t('settings.fontSans')}
                      field="fontSans"
                      size="fontSansSize"
                      weight="fontSansWeight"
                      suggestions={SANS_FONTS}
                      bundled="Inter"
                    />
                    <FontField
                      label={t('settings.fontMono')}
                      field="fontMono"
                      size="fontMonoSize"
                      weight="fontMonoWeight"
                      suggestions={MONO_FONTS}
                      bundled="JetBrains Mono"
                    />
                    <p class="text-fg-2">{t('settings.fontHint')}</p>
                  </div>
                  <div class="flex max-w-lg flex-col gap-1">
                    <label class="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={preferences.revealSecrets}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          updatePreferences((draft) => {
                            draft.revealSecrets = checked;
                          });
                        }}
                      />
                      {t('settings.revealSecrets')}
                    </label>
                    <p class="text-fg-2">{t('settings.revealSecretsWarning')}</p>
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
