import { flatten } from '@solid-primitives/i18n';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const english = flatten(en) as Record<string, unknown>;
const spanish = flatten(es) as Record<string, unknown>;
/** Leaf strings only (flatten also lists the intermediate objects). */
const strings = (dictionary: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(dictionary).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).toSorted();

describe('translations', () => {
  it('Spanish has exactly the English keys', () => {
    expect(Object.keys(strings(spanish)).toSorted()).toEqual(Object.keys(strings(english)).toSorted());
  });

  it('every translation keeps the placeholders of the English text', () => {
    const englishStrings = strings(english);
    const spanishStrings = strings(spanish);
    const mismatched = Object.keys(englishStrings).filter(
      (key) => placeholders(englishStrings[key]!).join() !== placeholders(spanishStrings[key] ?? '').join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('no translation is left empty', () => {
    expect(Object.entries(strings(spanish)).filter(([, text]) => !text.trim())).toEqual([]);
  });
});
