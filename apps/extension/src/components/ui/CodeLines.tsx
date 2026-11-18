import { tokenize, tokenLines, type Lang, type Token, type TokenKind } from '@betterdevtools/core';
import { createEffect, createMemo, For, Show } from 'solid-js';
import { groupByLine, splitAtMatches, type TextMatch } from '../../lib/search.ts';
import { createVirtualList } from '../../lib/virtual.ts';

const ROW_HEIGHT = 18;
/** Bodies above this size are shown without colours: tokenizing them would stall the panel. */
const HIGHLIGHT_MAX_CHARS = 300_000;
/** Lines longer than this (minified code) wrap instead of making the view kilometres wide. */
const WRAP_LINE_CHARS = 2_000;

const TOKEN_CLASS: Record<TokenKind, string> = {
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

function longestLineLength(text: string): number {
  let longest = 0;
  for (let start = 0; start <= text.length;) {
    const end = text.indexOf('\n', start);
    const lineEnd = end < 0 ? text.length : end;
    longest = Math.max(longest, lineEnd - start);
    start = lineEnd + 1;
  }
  return longest;
}

/**
 * Line-numbered, syntax-coloured text. Only the rows in view are rendered (virtualized), so a
 * 100 000-line response scrolls as smoothly as a short one. Search matches are drawn as <mark>.
 */
export default function CodeLines(props: {
  text: string;
  lang: Lang;
  /** Accessible name of the scrolling region. */
  label: string;
  matches?: readonly TextMatch[] | undefined;
  /** Index in `matches` of the match to emphasize and scroll to. */
  currentMatch?: number | undefined;
  /** 0-based line to highlight and scroll to (e.g. a source map position). */
  highlightLine?: number | undefined;
  /** Called with the 0-based line and column of the caret after a click or Enter. */
  onPick?: ((line: number, column: number) => void) | undefined;
  /** Grow to fill a flex column instead of capping the height. */
  fill?: boolean | undefined;
}) {
  let scroller: HTMLDivElement | undefined;

  const lines = createMemo<Token[][]>(() => {
    const text = props.text;
    if (props.lang !== 'plain' && text.length <= HIGHLIGHT_MAX_CHARS) return tokenLines(tokenize(text, props.lang));
    return text.split('\n').map((line): Token[] => (line ? [['text', line]] : []));
  });
  const longestLine = createMemo(() => longestLineLength(props.text));
  const wraps = createMemo(() => longestLine() > WRAP_LINE_CHARS);
  const gutterChars = createMemo(() => String(lines().length).length + 1);
  const matchesByLine = createMemo(() => groupByLine(props.matches ?? []));

  const virtual = createVirtualList({
    count: () => lines().length,
    scrollElement: () => scroller,
    estimateSize: ROW_HEIGHT,
    measured: true, // wrapped rows are taller than one line
    overscan: 20,
  });

  // bring the current match into view: first its row, then the mark itself (long lines scroll sideways)
  createEffect(
    () => props.matches?.[props.currentMatch ?? -1],
    (match) => {
      if (!match) return;
      virtual.scrollToIndex(match.line, 'center');
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
        'relative overflow-auto rounded-sm border border-line bg-bg font-mono text-[11.5px]/[18px] [tab-size:2]',
        props.fill ? 'min-h-24 flex-1' : 'max-h-[60vh]',
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
          width: wraps() ? '100%' : `max(100%, calc(${longestLine() + gutterChars()}ch + 1.5rem))`,
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
                <For each={splitAtMatches(lines()[item.index] ?? [], matchesByLine().get(item.index))}>
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
