import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import {
  entryCount,
  expandAllIds,
  isContainer,
  leafText,
  NO_TREE_MATCHES,
  parseForTree,
  pathText,
  revealIds,
  ROOT_ID,
  rowPath,
  searchTree,
  valueJson,
  visibleRows,
  type JsonValue,
  type NodeRow,
  type TreeRow,
} from '../../lib/json-tree.ts';
import { splitByQuery } from '../../lib/search.ts';
import { createVirtualList } from '../../lib/virtual.ts';
import { copyToClipboard, openContextMenu } from '../../state/ui.ts';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';
import IconButton from './IconButton.tsx';

const ROW_HEIGHT = 20;
/** "Expand all" opens containers until about this many rows show; past it the rest stays closed. */
const EXPAND_ALL_ROWS = 100_000;
/** Leaf values longer than this are cut on screen (copying still gives the whole value). */
const SHOWN_VALUE_CHARS = 1_000;
const INDENT_PX = 14;

function leafClass(value: JsonValue): string {
  if (typeof value === 'string') return 'text-syn-str';
  if (typeof value === 'number' || (typeof value === 'object' && value !== null)) return 'text-syn-num'; // ExactNumber too
  return 'text-syn-kw'; // true, false, null
}

/** Text with the search matches wrapped in <mark>. */
function Highlighted(props: { text: string; query: string; caseSensitive: boolean }) {
  return (
    <For each={splitByQuery(props.text, props.query, props.caseSensitive)}>{(piece) => (piece.hit ? <mark>{piece.text}</mark> : piece.text)}</For>
  );
}

/**
 * Collapsible JSON tree, virtualized: whatever the size of the document only the rows on screen
 * exist, big arrays and objects open in nested groups of 100, and search covers every key and
 * value (not just what is open), opening the way to each match. Numbers keep their exact text.
 */
export default function JsonTree(props: {
  text: string;
  /** A JSON.parse result the caller already has, reused when it is exact. */
  parsed?: { value: unknown } | null | undefined;
  label: string;
  query?: string | undefined;
  caseSensitive?: boolean | undefined;
  /** Index of the search match to show. */
  currentMatch?: number | undefined;
  /** Reports how many nodes match the search. */
  onMatches?: ((total: number, kept: number) => void) | undefined;
}) {
  let scroller: HTMLDivElement | undefined;
  const parsed = createMemo(() => parseForTree(props.text, props.parsed ?? undefined));
  const root = createMemo(() => {
    const result = parsed();
    return result.ok ? result.value : null;
  });
  const parseError = () => {
    const result = parsed();
    return result.ok ? '' : result.error;
  };

  // open containers and groups, by id; another document starts with only the root open
  const [open, setOpen] = createSignal<Set<string>>(() => {
    void props.text;
    return new Set([ROOT_ID]);
  });
  const [onlyMatches, setOnlyMatches] = createSignal(false);
  const [tooLarge, setTooLarge] = createSignal(false);

  const query = () => props.query ?? '';
  const caseSensitive = () => props.caseSensitive ?? false;
  const search = createMemo(() => {
    const value = root();
    return value === null ? NO_TREE_MATCHES : searchTree(value, query(), caseSensitive());
  });
  createEffect(search, (result) => {
    props.onMatches?.(result.total, result.ids.length);
  });
  const filtering = () => onlyMatches() && search().ids.length > 0;

  const rows = createMemo<TreeRow[]>(() => {
    const value = root();
    if (value === null) return [];
    const opened = open();
    return visibleRows(value, (id) => opened.has(id), filtering() ? search().filter : null);
  });
  const currentId = () => search().ids[props.currentMatch ?? -1];

  const virtual = createVirtualList({
    count: () => rows().length,
    scrollElement: () => scroller,
    estimateSize: ROW_HEIGHT,
    measured: true, // the row height follows the code font size setting
    overscan: 20,
  });

  // the current match: open the way to it, then scroll it into view
  createEffect(currentId, (id) => {
    const value = root();
    const path = search().paths[props.currentMatch ?? -1];
    if (!id || value === null || !path) return;
    const missing = revealIds(value, path).filter((openId) => !open().has(openId));
    if (missing.length) setOpen(new Set([...open(), ...missing]));
    requestAnimationFrame(() => {
      const index = rows().findIndex((row) => row.id === id);
      if (index >= 0) virtual.scrollToIndex(index, 'center');
    });
  });

  function toggle(id: string) {
    const next = new Set(open());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  }

  function expandAll() {
    const value = root();
    if (value === null) return;
    const { ids, complete } = expandAllIds(value, EXPAND_ALL_ROWS);
    setTooLarge(!complete);
    setOpen(ids);
  }

  function collapseAll() {
    setTooLarge(false);
    setOpen(new Set<string>());
  }

  function openRowMenu(event: MouseEvent, row: NodeRow) {
    event.preventDefault();
    const path = pathText(rowPath(row));
    openContextMenu(event, t('tree.rowActions'), [
      {
        label: t('tree.copyValue'),
        run: () =>
          void copyToClipboard(
            isContainer(row.value) ? valueJson(row.value) : typeof row.value === 'string' ? row.value : leafText(row.value),
            t('tree.value'),
          ),
      },
      { label: t('tree.copyPath'), run: () => void copyToClipboard(path, path) },
    ]);
  }

  const summary = (value: JsonValue) => {
    if (!isContainer(value)) return '';
    const count = formatNumber(entryCount(value));
    return Array.isArray(value) ? `[…] ${t('tree.items', { count })}` : `{…} ${t('tree.keys', { count })}`;
  };
  const shownLeaf = (value: JsonValue) => {
    const text = leafText(value);
    return text.length > SHOWN_VALUE_CHARS ? `${text.slice(0, SHOWN_VALUE_CHARS)}…` : text;
  };

  return (
    <section aria-label={t('tree.label', { label: props.label })} class="flex min-h-0 flex-1 flex-col gap-1">
      <Show when={root() !== null} fallback={<p class="text-warn">{parseError()}</p>}>
        <div class="flex flex-wrap items-center gap-1">
          <IconButton icon="expand" label={t('tree.expandAll')} text={t('tree.expandAll')} onClick={expandAll} />
          <IconButton icon="collapse" label={t('tree.collapseAll')} text={t('tree.collapseAll')} onClick={collapseAll} />
          <IconButton
            icon="filter"
            label={t('tree.onlyMatchesHint')}
            text={t('tree.onlyMatches')}
            pressed={onlyMatches()}
            disabled={!query()}
            onClick={() => setOnlyMatches(!onlyMatches())}
          />
          <Show when={tooLarge()}>
            <span class="text-fg-2" role="status">
              {t('tree.tooLarge', { count: formatNumber(EXPAND_ALL_ROWS) })}
            </span>
          </Show>
          <Show when={search().total > search().ids.length}>
            <span class="text-fg-2">{t('tree.matchesKept', { count: formatNumber(search().ids.length) })}</span>
          </Show>
        </div>
        <div
          ref={(element) => (scroller = element)}
          class="min-h-24 flex-1 overflow-auto rounded-sm border border-line font-mono text-code"
          tabindex="0"
          role="region"
          aria-label={t('tree.nodes')}
        >
          <ul class="relative min-w-full" style={{ height: `${virtual.totalSize()}px` }}>
            <For each={virtual.items()}>
              {(item) => (
                <Show when={rows()[item.index]}>
                  {(row) => (
                    <li
                      ref={virtual.measure}
                      data-index={item.index}
                      class={[
                        'group/row absolute start-0 top-0 flex min-w-full items-center gap-1 pe-2 whitespace-nowrap hover:bg-bg-3',
                        { 'bg-sel outline -outline-offset-1 outline-accent': row().id === currentId() },
                      ]}
                      style={{ transform: `translateY(${item.start}px)`, 'padding-inline-start': `${row().depth * INDENT_PX + 4}px` }}
                      onContextMenu={(event) => {
                        const current = row();
                        if (current.kind === 'node') openRowMenu(event, current);
                      }}
                    >
                      <Switch>
                        <Match when={row().kind === 'group' ? (row() as Extract<TreeRow, { kind: 'group' }>) : null}>
                          {(group) => (
                            <button
                              type="button"
                              class="flex cursor-pointer items-center gap-0.5 rounded-sm text-fg-2"
                              aria-expanded={open().has(group().id) ? 'true' : 'false'}
                              onClick={() => toggle(group().id)}
                            >
                              <Icon name={open().has(group().id) ? 'chevron-down' : 'chevron-right'} />
                              {t('tree.range', { from: formatNumber(group().from), to: formatNumber(group().to) })}
                            </button>
                          )}
                        </Match>
                        <Match when={row().kind === 'node' ? (row() as NodeRow) : null}>
                          {(node) => (
                            <>
                              <Show when={isContainer(node().value)} fallback={<span class="inline-block w-4 shrink-0" />}>
                                <button
                                  type="button"
                                  class="inline-flex shrink-0 cursor-pointer rounded-sm"
                                  aria-expanded={filtering() || open().has(node().id) ? 'true' : 'false'}
                                  aria-label={node().key === null ? t('tree.root') : String(node().key)}
                                  onClick={() => toggle(node().id)}
                                >
                                  <Icon name={filtering() || open().has(node().id) ? 'chevron-down' : 'chevron-right'} />
                                </button>
                              </Show>
                              <Show when={node().key !== null}>
                                <span class={typeof node().key === 'number' ? 'text-fg-2' : 'text-syn-prop'}>
                                  <Highlighted
                                    text={String(node().key)}
                                    query={typeof node().key === 'number' ? '' : query()}
                                    caseSensitive={caseSensitive()}
                                  />
                                </span>
                                <span class="text-fg-2">:</span>
                              </Show>
                              <Show
                                when={isContainer(node().value)}
                                fallback={
                                  <span class={leafClass(node().value)}>
                                    <Highlighted text={shownLeaf(node().value)} query={query()} caseSensitive={caseSensitive()} />
                                  </span>
                                }
                              >
                                <span class="text-fg-2">{summary(node().value)}</span>
                              </Show>
                              <Show when={!isContainer(node().value)}>
                                <span class="ms-auto opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                                  <CopyButton
                                    text={() => (typeof node().value === 'string' ? (node().value as string) : leafText(node().value))}
                                    label={t('tree.copyValue')}
                                  />
                                </span>
                              </Show>
                            </>
                          )}
                        </Match>
                      </Switch>
                    </li>
                  )}
                </Show>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </section>
  );
}
