// User preferences: validated when loaded, saved to IndexedDB shortly after each change.
import { createStore, flush, snapshot } from 'solid-js';
import * as v from 'valibot';
import { applyLocale } from '../i18n/index.ts';
import { db } from '../lib/db.ts';
import { logEvent } from '../lib/io.ts';

const PreferenceFields = v.object({
  theme: v.picklist(['system', 'light', 'dark']),
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
  /** Share of the width taken by the details pane when it is open. */
  detailFraction: v.pipe(v.number(), v.minValue(0.2), v.maxValue(0.85)),
  /** Where replays are sent from when both are possible. */
  sendFrom: v.picklist(['page', 'extension']),
  workspaceId: v.nullable(v.string()),
});

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
  detailFraction: 0.5,
  sendFrom: 'page',
  workspaceId: null,
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
