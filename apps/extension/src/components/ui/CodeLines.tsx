import { tokenize, tokenLines, type Lang, type Token, type TokenKind } from '@betterdevtools/core';
import { createEffect, createMemo, For, Show } from 'solid-js';
import {
  indexLines,
  lineCount,
  lineEnd,
  lineOfOffset,
  lineText,
  matchesBetween,
  splitAtMatches,
  type TextLines,
  type TextSearch,
} from '../../lib/search.ts';
import { createVirtualList } from '../../lib/virtual.ts';

const ROW_HEIGHT = 18;
/**
 * JS, CSS and markup up to this size are coloured as a whole, so comments and strings that span
 * lines are exact. Bigger ones, and JSON always, are coloured line by line as rows scroll into
 * view: JSON tokens never span lines, so that is exact for JSON at any size.
 */
const WHOLE_TEXT_MAX_CHARS = 500_000;
/** A single line longer than this (a huge string value) is shown without colours. */
const LINE_COLOUR_MAX_CHARS = 100_000;
/** Lines longer than this (minified code) wrap instead of making the view kilometres wide. */
const WRAP_LINE_CHARS = 2_000;

export const TOKEN_CLASS: Record<TokenKind, string> = {
  kw: 'text-syn-kw',
  str: 'text-syn-str',
  num: 'text-syn-num',
  com: 'text-syn-com italic',
  prop: 'text-syn-prop',
  tag: 'text-syn-tag',
  attr: 'text-syn-attr',
  punct: 'text-fg-2',
  op: '',
  text: '',
};

/**
 * Line-numbered, syntax-coloured text. Only the rows in view are rendered (virtualized) and only
 * those rows are sliced and coloured, so a 3-million-line response scrolls like a short one.
 * Search matches are drawn as <mark>.
 */
export default function CodeLines(props: {
  /** The text, or its line index when the caller already built it (shared with the search). */
  text?: string | undefined;
  lines?: TextLines | undefined;
  lang: Lang;
  /** Accessible name of the scrolling region. */
  label: string;
  search?: TextSearch | undefined;
  /** Index in the search of the match to emphasize and scroll to. */
  currentMatch?: number | undefined;
  /** 0-based line to highlight and scroll to (e.g. a source map position). */
  highlightLine?: number | undefined;
  /** Called with the 0-based line and column of the caret after a click or Enter. */
  onPick?: ((line: number, column: number) => void) | undefined;
  /** Grow to fill a flex column instead of capping the height. */
  fill?: boolean | undefined;
}) {
  let scroller: HTMLDivElement | undefined;

  const source = createMemo(() => props.lines ?? indexLines(props.text ?? ''));
  const wholeTokens = createMemo<Token[][] | null>(() => {
    const text = source().text;
    const lang = props.lang;
    return lang !== 'plain' && lang !== 'json' && text.length <= WHOLE_TEXT_MAX_CHARS ? tokenLines(tokenize(text, lang)) : null;
  });
  function rowTokens(line: number): Token[] {
    const whole = wholeTokens();
    if (whole) return whole[line] ?? [];
    const text = lineText(source(), line);
    if (!text) return [];
    return props.lang === 'plain' || text.length > LINE_COLOUR_MAX_CHARS ? [['text', text]] : tokenize(text, props.lang);
  }
  const rowMatches = (line: number) =>
    props.search ? matchesBetween(props.search, source().starts[line]!, lineEnd(source(), line)) : undefined;

  const wraps = createMemo(() => source().longest > WRAP_LINE_CHARS);
  const gutterChars = createMemo(() => String(lineCount(source())).length + 1);

  const virtual = createVirtualList({
    count: () => lineCount(source()),
    scrollElement: () => scroller,
    estimateSize: ROW_HEIGHT,
    measured: true, // wrapped rows are taller than one line
    overscan: 20,
  });

  // bring the current match into view: first its row, then the mark itself (long lines scroll sideways)
  createEffect(
    () => {
      const offset = props.search?.offsets[props.currentMatch ?? -1];
      return offset === undefined ? -1 : lineOfOffset(source(), offset);
    },
    (line) => {
      if (line < 0) return;
      virtual.scrollToIndex(line, 'center');
      requestAnimationFrame(() => scroller?.querySelector('mark[data-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    },
  );

  createEffect(
    () => props.highlightLine ?? -1,
    (line) => {
      if (line >= 0) virtual.scrollToIndex(line, 'center');
    },
  );

  // Source maps: the caret position inside a line becomes a (line, column) pair.
  function pickCaretPosition() {
    const onPick = props.onPick;
    const selection = getSelection();
    const node = selection?.anchorNode;
    if (!onPick || !selection || !node) return;
    const element = node instanceof Element ? node : node.parentElement;
    const row = element?.closest<HTMLElement>('[data-line]');
    const code = row?.querySelector('[data-code]');
    if (!row || !code || !code.contains(node)) return;
    const beforeCaret = document.createRange();
    beforeCaret.setStart(code, 0);
    beforeCaret.setEnd(node, selection.anchorOffset);
    onPick(Number(row.dataset.line), beforeCaret.toString().length);
  }

  return (
    <div
      ref={(element) => (scroller = element)}
      class={[
        'relative overflow-auto rounded-sm border border-line bg-bg font-mono text-code [tab-size:2]',
        props.fill ? 'min-h-24 flex-1' : 'max-h-[calc(var(--vh)*0.6)]',
      ]}
      role="region"
      aria-label={props.label}
      tabindex="0"
      onClick={() => pickCaretPosition()}
      onKeyDown={(event) => event.key === 'Enter' && pickCaretPosition()}
    >
      <div
        class="relative"
        style={{
          height: `${virtual.totalSize()}px`,
          width: wraps() ? '100%' : `max(100%, calc(${source().longest + gutterChars()}ch + 1.5rem))`,
        }}
      >
        <For each={virtual.items()}>
          {(item) => (
            <div
              ref={virtual.measure}
              data-index={item.index}
              data-line={item.index}
              class={['absolute start-0 top-0 flex w-full', { 'bg-sel': item.index === props.highlightLine }]}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <span
                aria-hidden="true"
                class="sticky start-0 shrink-0 bg-bg-2 pe-2 text-end text-fg-2 select-none"
                style={{ width: `${gutterChars() + 1}ch` }}
              >
                {item.index + 1}
              </span>
              <span data-code class={['ps-2', wraps() ? 'min-w-0 flex-1 break-all whitespace-pre-wrap' : 'whitespace-pre']}>
                <For each={splitAtMatches(rowTokens(item.index), rowMatches(item.index))}>
                  {(piece) => (
                    <Show
                      when={piece.match >= 0}
                      fallback={
                        <span class={TOKEN_CLASS[piece.kind]} data-token={piece.kind === 'text' ? undefined : piece.kind}>
                          {piece.text}
                        </span>
                      }
                    >
                      <mark class={TOKEN_CLASS[piece.kind]} data-current={piece.match === props.currentMatch ? '' : undefined}>
                        {piece.text}
                      </mark>
                    </Show>
                  )}
                </For>
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
