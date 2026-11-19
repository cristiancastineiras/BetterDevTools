// Find-in-body over big texts. The text is never split into an array of lines: an index of
// where each line starts is built once, lines are sliced only when they are drawn, and searching
// runs the engine's native indexOf over the whole text. Matches are kept as offsets in a typed
// array, so a million of them cost 4 MB and no objects.
// Pure functions, unit-tested in test/ui-logic.test.ts.
import type { Token, TokenKind } from '@betterdevtools/core';

// ------------------------------------------------------------------------------- line index

/** Where each line of `text` starts. */
export interface TextLines {
  text: string;
  /** Offset of the first character of each line. */
  starts: Int32Array;
  /** Length of the longest line, for the width of the view. */
  longest: number;
}

export function indexLines(text: string): TextLines {
  let count = 1;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) count++;
  const starts = new Int32Array(count);
  let longest = 0;
  let line = 1;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    longest = Math.max(longest, at - starts[line - 1]!);
    starts[line++] = at + 1;
  }
  longest = Math.max(longest, text.length - starts[count - 1]!);
  return { text, starts, longest };
}

export const lineCount = (lines: TextLines): number => lines.starts.length;

/** End offset (exclusive, before the line break) of line `line`. */
export const lineEnd = (lines: TextLines, line: number): number =>
  line + 1 < lines.starts.length ? lines.starts[line + 1]! - 1 : lines.text.length;

export const lineText = (lines: TextLines, line: number): string => lines.text.slice(lines.starts[line], lineEnd(lines, line));

/** The line that holds `offset` (binary search). */
export function lineOfOffset(lines: TextLines, offset: number): number {
  const starts = lines.starts;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

// ----------------------------------------------------------------------------------- search

/** Matches past this many are still counted but not kept (nor highlighted). */
export const MAX_STORED_MATCHES = 1_000_000;

export interface TextSearch {
  /** Length of each match. */
  length: number;
  /** Start offsets of the matches kept, in order. */
  offsets: Int32Array;
  /** Every match in the text, kept or not. */
  total: number;
}

export const NO_MATCHES: TextSearch = { length: 0, offsets: new Int32Array(0), total: 0 };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every non-overlapping occurrence of `query`. Case-insensitive search runs indexOf on a lower-case
 * copy of the text (made once by the caller through `lowered`); when lower-casing changes lengths
 * (a few Unicode letters do), offsets would drift, so a case-insensitive RegExp is used instead.
 */
export function searchText(text: string, query: string, caseSensitive: boolean, lowered?: () => string): TextSearch {
  if (!query) return NO_MATCHES;
  let offsets = new Int32Array(1024);
  let stored = 0;
  let total = 0;
  const keep = (offset: number) => {
    total++;
    if (stored >= MAX_STORED_MATCHES) return;
    if (stored === offsets.length) {
      const grown = new Int32Array(Math.min(offsets.length * 2, MAX_STORED_MATCHES));
      grown.set(offsets);
      offsets = grown;
    }
    offsets[stored++] = offset;
  };

  const needle = caseSensitive ? query : query.toLowerCase();
  const haystack = caseSensitive ? text : (lowered?.() ?? text.toLowerCase());
  if (caseSensitive || (needle.length === query.length && haystack.length === text.length)) {
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) keep(at);
    return { length: needle.length, offsets: offsets.subarray(0, stored), total };
  }
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  let length = query.length;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    length = match[0].length;
    keep(match.index);
  }
  return { length, offsets: offsets.subarray(0, stored), total };
}

/** First kept match that starts at or after `offset` (binary search); `offsets.length` if none. */
function firstMatchFrom(search: TextSearch, offset: number): number {
  let low = 0;
  let high = search.offsets.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (search.offsets[mid]! < offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Matches inside [from, to), as ranges relative to `from`, each with its index in the search. */
export function matchesBetween(search: TextSearch, from: number, to: number): { start: number; end: number; index: number }[] {
  const ranges: { start: number; end: number; index: number }[] = [];
  if (!search.offsets.length) return ranges;
  // a match that starts just before `from` can still reach into the range
  for (let index = Math.max(0, firstMatchFrom(search, from - search.length + 1)); index < search.offsets.length; index++) {
    const start = search.offsets[index]!;
    if (start >= to) break;
    ranges.push({ start: Math.max(0, start - from), end: Math.min(to, start + search.length) - from, index });
  }
  return ranges;
}

// ---------------------------------------------------------------------------- highlighting

/** A run of text with one token colour; `match` is the match index it belongs to, or -1. */
export interface Piece {
  kind: TokenKind;
  text: string;
  match: number;
}

/**
 * Cuts a line's tokens at match boundaries, so a match spanning several tokens keeps each
 * token's colour and every piece knows whether (and in which match) it is highlighted.
 */
export function splitAtMatches(tokens: readonly Token[], ranges: readonly { start: number; end: number; index: number }[] = []): Piece[] {
  if (!ranges.length) return tokens.map(([kind, text]) => ({ kind, text, match: -1 }));
  const pieces: Piece[] = [];
  let offset = 0; // column where the current token starts
  let rangeIndex = 0;
  for (const [kind, text] of tokens) {
    const tokenEnd = offset + text.length;
    let cursor = offset;
    while (cursor < tokenEnd) {
      // skip ranges that ended before the cursor
      while (rangeIndex < ranges.length && ranges[rangeIndex]!.end <= cursor) rangeIndex++;
      const range = ranges[rangeIndex];
      if (!range || range.start >= tokenEnd) {
        pieces.push({ kind, text: text.slice(cursor - offset), match: -1 });
        cursor = tokenEnd;
      } else if (range.start > cursor) {
        pieces.push({ kind, text: text.slice(cursor - offset, range.start - offset), match: -1 });
        cursor = range.start;
      } else {
        const pieceEnd = Math.min(range.end, tokenEnd);
        pieces.push({ kind, text: text.slice(cursor - offset, pieceEnd - offset), match: range.index });
        cursor = pieceEnd;
      }
    }
    offset = tokenEnd;
  }
  return pieces;
}

/** Splits plain text around occurrences of `query` (for short strings such as JSON tree values). */
export function splitByQuery(text: string, query: string, caseSensitive: boolean): { text: string; hit: boolean }[] {
  if (!query) return [{ text, hit: false }];
  const search = searchText(text, query, caseSensitive);
  if (!search.total) return [{ text, hit: false }];
  const pieces = splitAtMatches([['text', text]], matchesBetween(search, 0, text.length));
  return pieces.map((piece) => ({ text: piece.text, hit: piece.match >= 0 }));
}
