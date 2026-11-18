// UI language: English and Spanish, switchable at runtime. Strings are looked up with t('a.b.c');
// the keys are type-checked against the English dictionary.
import { flatten, resolveTemplate, translator } from '@solid-primitives/i18n';
import { createSignal } from 'solid-js';
import { en } from './en.ts';
import { es } from './es.ts';

export type Locale = 'en' | 'es';
export type LocalePreference = Locale | 'auto';

const DICTIONARIES = { en: flatten(en), es: flatten(es) };

/** The browser UI language, used when the preference is "auto". */
export function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

const [locale, setLocaleSignal] = createSignal<Locale>(browserLocale());
export { locale };

export function applyLocale(preference: LocalePreference): void {
  const next = preference === 'auto' ? browserLocale() : preference;
  setLocaleSignal(next);
  document.documentElement.lang = next;
}

/** Translates a key; `{{ name }}` placeholders are filled from the second argument. Reactive. */
export const t = translator(() => DICTIONARIES[locale()], resolveTemplate);

/** Number formatting for the current language (thousand separators). */
export const formatNumber = (value: number): string => value.toLocaleString(locale());
