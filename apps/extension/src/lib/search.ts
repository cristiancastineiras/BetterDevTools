// Find-in-body: locating matches in text and cutting highlighted lines into marked pieces.
// Pure functions, unit-tested in test/ui-logic.test.ts.
import type { Token, TokenKind } from '@betterdevtools/core';

/** One match of the search text: 0-based line and [start, end) columns in that line. */
export interface TextMatch {
  line: number;
  start: number;
  end: number;
}

/** Past this many matches the count reads "10000+" and later matches are not highlighted. */
export const MAX_MATCHES = 10_000;

/** Finds every non-overlapping occurrence of `query`, line by line. */
export function findMatches(lines: readonly string[], query: string, caseSensitive: boolean): TextMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];
  for (let line = 0; line < lines.length; line++) {
    const haystack = caseSensitive ? lines[line]! : lines[line]!.toLowerCase();
    for (let start = haystack.indexOf(needle); start >= 0; start = haystack.indexOf(needle, start + needle.length)) {
      matches.push({ line, start, end: start + needle.length });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/** Ranges per line, each with its position in the whole match list (to mark the current one). */
export type LineMatches = Map<number, { start: number; end: number; index: number }[]>;

export function groupByLine(matches: readonly TextMatch[]): LineMatches {
  const byLine: LineMatches = new Map();
  matches.forEach((match, index) => {
    const ranges = byLine.get(match.line);
    const range = { start: match.start, end: match.end, index };
    if (ranges) ranges.push(range);
    else byLine.set(match.line, [range]);
  });
  return byLine;
}

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
  const pieces = splitAtMatches(
    [['text', text]],
    findMatches([text], query, caseSensitive).map((match, index) => ({ ...match, index })),
  );
  return pieces.map((piece) => ({ text: piece.text, hit: piece.match >= 0 }));
}
