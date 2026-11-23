export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
  /** Replacement template (`$1`, `$<name>`, `$&`); null skips the replace preview. */
  replacement: string | null;
}

export interface RegexMatch {
  index: number;
  length: number;
  text: string;
  /** Capture groups 1..n (undefined when a group did not take part). */
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export type RegexOutcome = { ok: true; matches: RegexMatch[]; replaced: string | null; more: boolean } | { ok: false; error: string };

export const MAX_REGEX_TEXT = 2_000_000;
export const REGEX_FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;

/**
 * Runs a JavaScript regular expression. It runs on the caller's thread: a pattern that backtracks
 * without end never returns, so the panel runs this inside a worker it can stop (see regex-worker).
 */
export function runRegex(request: RegexRequest, limit = 1000): RegexOutcome {
  if (request.text.length > MAX_REGEX_TEXT)
    return { ok: false, error: `The text is longer than ${MAX_REGEX_TEXT.toLocaleString('en')} characters` };
  const flags = [...new Set(request.flags)].join('');
  let re: RegExp;
  try {
    re = new RegExp(request.pattern, flags);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const found = re.global ? request.text.matchAll(re) : [re.exec(request.text)];
  const matches: RegexMatch[] = [];
  let more = false;
  for (const match of found) {
    if (!match) continue;
    if (matches.length >= limit) {
      more = true;
      break;
    }
    matches.push({
      index: match.index,
      length: match[0].length,
      text: match[0],
      groups: match.slice(1),
      named: { ...match.groups },
    });
  }
  return { ok: true, matches, more, replaced: request.replacement === null ? null : request.text.replace(re, request.replacement) };
}
