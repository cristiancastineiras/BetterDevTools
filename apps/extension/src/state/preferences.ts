// User preferences: validated when loaded, saved to IndexedDB shortly after each change.
import { createStore, flush, snapshot } from 'solid-js';
import * as v from 'valibot';
import { applyLocale } from '../i18n/index.ts';
import { db } from '../lib/db.ts';
import { logEvent } from '../lib/io.ts';

/** Each theme and the colour scheme it uses (null = follow the system); app.css defines the named ones. */
export const THEMES = {
  system: null,
  light: 'light',
  dark: 'dark',
  'atom-one-dark': 'dark',
  'atom-one-light': 'light',
  dracula: 'dark',
  nord: 'dark',
  'solarized-light': 'light',
  'solarized-dark': 'dark',
} as const;
export const THEME_NAMES: Partial<Record<keyof typeof THEMES, string>> = {
  'atom-one-dark': 'Atom One Dark',
  'atom-one-light': 'Atom One Light',
  dracula: 'Dracula',
  nord: 'Nord',
  'solarized-light': 'Solarized Light',
  'solarized-dark': 'Solarized Dark',
};

export const PreferenceFields = v.object({
  theme: v.picklist(Object.keys(THEMES) as (keyof typeof THEMES)[]),
  locale: v.picklist(['auto', 'en', 'es']),
  /** Ring buffer size: the oldest captured requests are dropped beyond it. */
  capacity: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(100_000)),
  maxBodyKB: v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(51_200)),
  bodyBudgetMB: v.pipe(v.number(), v.integer(), v.minValue(8), v.maxValue(2048)),
  preserveLog: v.boolean(),
  /** Free-text filter terms also search response bodies. */
  searchBodies: v.boolean(),
  /** Widths in px of the request list columns: status, method, domain, path, type, size, time. */
  columnWidths: v.pipe(v.array(v.pipe(v.number(), v.minValue(32), v.maxValue(2000))), v.length(7)),
  /** Request list columns the user hid; the path column is always shown. */
  hiddenColumns: v.array(v.picklist(['status', 'method', 'domain', 'type', 'size', 'time'])),
  /** Share of the width taken by the details pane when it is open. */
  detailFraction: v.pipe(v.number(), v.minValue(0.2), v.maxValue(0.85)),
  /** Where replays are sent from when both are possible. */
  sendFrom: v.picklist(['page', 'extension']),
  workspaceId: v.nullable(v.string()),
  /** Show hidden tokens, cookies and secret headers in every request, not one request at a time. */
  revealSecrets: v.boolean(),
  /** User agent for replays; empty keeps the browser's own. Printable ASCII only: it becomes a header value. */
  userAgent: v.pipe(v.string(), v.maxLength(300), v.regex(/^[\x20-\x7e]*$/)),
  /** Accent colour as #rrggbb; empty keeps the built-in blue. */
  accent: v.pipe(v.string(), v.regex(/^(#[0-9a-f]{6})?$/i)),
  /** Size of the whole interface (CSS zoom). */
  uiScale: v.picklist(['compact', 'default', 'large', 'xlarge']),
  /** Custom font families; empty keeps the bundled font. Quotes, backslashes and `;` could break the CSS. */
  fontSans: v.pipe(v.string(), v.maxLength(80), v.regex(/^[^"'\\;{}<>]*$/)),
  fontMono: v.pipe(v.string(), v.maxLength(80), v.regex(/^[^"'\\;{}<>]*$/)),
  /** Font size in percent of the normal one, and the weight of regular text (a multiple of 100). */
  fontSansSize: v.pipe(v.number(), v.integer(), v.minValue(70), v.maxValue(150)),
  fontSansWeight: v.pipe(v.number(), v.integer(), v.minValue(300), v.maxValue(700), v.multipleOf(100)),
  fontMonoSize: v.pipe(v.number(), v.integer(), v.minValue(70), v.maxValue(150)),
  fontMonoWeight: v.pipe(v.number(), v.integer(), v.minValue(300), v.maxValue(700), v.multipleOf(100)),
});

export const UI_ZOOM: Record<Preferences['uiScale'], number> = { compact: 1, default: 1.15, large: 1.3, xlarge: 1.5 };

export const PreferencesSchema = v.pipe(
  PreferenceFields,
  v.check((p) => p.maxBodyKB <= p.bodyBudgetMB * 1024, 'One body cannot be larger than the memory for all bodies'),
);
export type Preferences = v.InferOutput<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  locale: 'auto',
  capacity: 10_000,
  maxBodyKB: 2048,
  bodyBudgetMB: 128,
  preserveLog: true,
  searchBodies: false,
  columnWidths: [58, 66, 170, 360, 120, 76, 76],
  hiddenColumns: [],
  detailFraction: 0.5,
  sendFrom: 'page',
  workspaceId: null,
  revealSecrets: false,
  userAgent: '',
  accent: '',
  uiScale: 'default',
  fontSans: '',
  fontMono: '',
  fontSansSize: 100,
  fontSansWeight: 400,
  fontMonoSize: 100,
  fontMonoWeight: 400,
};

export const [preferences, setPreferencesStore] = createStore<Preferences>(structuredClone(DEFAULT_PREFERENCES));

const SAVE_DELAY_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let onSaveError: (error: unknown) => void = () => undefined;

/** Lets the UI report failed saves (kept here as a callback to avoid an import cycle). */
export function onPreferencesSaveError(handler: (error: unknown) => void): void {
  onSaveError = handler;
}

/** Changes preferences in place and saves them a moment later (rapid changes are coalesced). */
export function updatePreferences(change: (draft: Preferences) => void): void {
  setPreferencesStore(change);
  flush(); // callers often read the new value right away (e.g. refilter after toggling a search option)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.put('kv', snapshot(preferences), 'prefs').catch(onSaveError);
  }, SAVE_DELAY_MS);
}

/** Loads stored preferences; unknown or invalid fields fall back to the defaults. */
export async function loadPreferences(): Promise<void> {
  const stored = await db.get('kv', 'prefs');
  const known = v.safeParse(v.partial(PreferenceFields), stored ?? {});
  const merged = v.safeParse(PreferencesSchema, { ...DEFAULT_PREFERENCES, ...(known.success ? known.output : {}) });
  if (merged.success) setPreferencesStore(() => merged.output);
  else logEvent('warn', 'preferences.invalid', { issue: merged.issues[0].message });
  flush();
  applyLocale(preferences.locale);
}
