import { formatBytes, methodToken, statusToken, type Captured } from '@betterdevtools/core';
import { createEffect, createMemo, For, Match, Show, Switch } from 'solid-js';
import { t } from '../i18n/index.ts';
import { uiZoom } from '../lib/place.ts';
import { createVirtualList } from '../lib/virtual.ts';
import {
  activeRequestId,
  attachedToDevtools,
  capturedCount,
  filterText,
  isRecording,
  isRequestSelected,
  selectAllVisible,
  selectRequest,
  visibleRequests,
} from '../state/capture.ts';
import { preferences, updatePreferences } from '../state/preferences.ts';
import { openContextMenu } from '../state/ui.ts';
import { BADGE_CLASS, badgeColors } from './ui/MethodBadge.tsx';
import { monoClass } from './ui/styles.ts';

const ROW_HEIGHT = 22;
const MIN_COLUMN_PX = 32;
const MAX_COLUMN_PX = 2000;
const PATH_COLUMN = 3;

type ColumnKey = 'status' | 'method' | 'domain' | 'path' | 'type' | 'size' | 'time';
const COLUMNS: { key: ColumnKey; text: (request: Captured) => string }[] = [
  { key: 'status', text: (request) => (request.status ? String(request.status) : request.error ? t('network.failed') : '—') },
  { key: 'method', text: (request) => request.method },
  { key: 'domain', text: (request) => request.host },
  { key: 'path', text: (request) => request.path },
  { key: 'type', text: (request) => request.type || request.mime },
  { key: 'size', text: (request) => formatBytes(request.size) },
  { key: 'time', text: (request) => `${Math.round(request.duration)} ms` },
];

/** Columns the user can hide; the path column carries the URL and stays. */
type HideableKey = Exclude<ColumnKey, 'path'>;

function toggleColumn(key: HideableKey) {
  updatePreferences((draft) => {
    draft.hiddenColumns = draft.hiddenColumns.includes(key) ? draft.hiddenColumns.filter((hidden) => hidden !== key) : [...draft.hiddenColumns, key];
  });
}

/** Menu to show or hide columns (from the toolbar button or a right click on the header). */
export function openColumnsMenu(at: { clientX: number; clientY: number }): void {
  openContextMenu(
    at,
    t('network.columnsMenu'),
    COLUMNS.filter((column): column is (typeof COLUMNS)[number] & { key: HideableKey } => column.key !== 'path').map((column) => ({
      label: `${preferences.hiddenColumns.includes(column.key) ? '\u2003\u2002' : '✓\u2002'}${t(`network.columns.${column.key}`)}`,
      run: () => toggleColumn(column.key),
    })),
  );
}

const rowId = (requestId: number) => `request-row-${requestId}`;

function setColumnWidth(column: number, width: number) {
  const clamped = Math.max(MIN_COLUMN_PX, Math.min(MAX_COLUMN_PX, Math.round(width)));
  updatePreferences((draft) => {
    draft.columnWidths[column] = clamped;
  });
}

function startColumnResize(event: PointerEvent, column: number) {
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = preferences.columnWidths[column] ?? 80;
  const zoom = uiZoom(); // pointer movement is in window pixels, widths in zoomed ones
  const onMove = (move: PointerEvent) => setColumnWidth(column, startWidth + (move.clientX - startX) / zoom);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('lostpointercapture', () => handle.removeEventListener('pointermove', onMove), { once: true });
}

function onColumnResizeKey(event: KeyboardEvent, column: number) {
  const step = { ArrowLeft: -10, ArrowRight: 10 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  setColumnWidth(column, (preferences.columnWidths[column] ?? 80) + step);
}

/**
 * The captured requests as an ARIA grid. Only the rows in view exist in the DOM, so 50 000
 * requests scroll like 50. Click, Ctrl/Cmd-click and Shift-click select; arrows, Page Up/Down,
 * Home/End move; Space toggles; Shift+F10 or the context menu key opens the actions menu.
 */
export default function RequestList(props: { onRowMenu: (at: { clientX: number; clientY: number }) => void }) {
  let grid: HTMLDivElement | undefined;

  const virtual = createVirtualList({
    count: () => visibleRequests().length,
    scrollElement: () => grid,
    estimateSize: ROW_HEIGHT,
    paddingStart: ROW_HEIGHT, // the sticky header row
    overscan: 12,
  });

  // New requests keep the list scrolled to the end, until the user scrolls away from it;
  // scrolling back to the end follows again. Only the user's scrolling changes this flag.
  let followEnd = true;
  const nearEnd = () => grid !== undefined && grid.scrollHeight - grid.scrollTop - grid.clientHeight < 8;
  createEffect(
    () => visibleRequests().length,
    () => {
      if (followEnd) requestAnimationFrame(() => followEnd && grid && (grid.scrollTop = grid.scrollHeight));
    },
  );

  // the columns in view, each with its place in the saved widths
  const columns = createMemo(() =>
    COLUMNS.map((column, index) => ({ ...column, index })).filter((column) => !preferences.hiddenColumns.includes(column.key as HideableKey)),
  );
  // the path column takes the free space, so the list adapts when the details pane is resized
  const gridColumns = createMemo(() =>
    columns()
      .map(({ index }) => (index === PATH_COLUMN ? `minmax(${preferences.columnWidths[index]}px, 1fr)` : `${preferences.columnWidths[index]}px`))
      .join(' '),
  );
  // Rows are exactly as wide as the columns (or the panel, when that is wider): a long URL is
  // cut by `truncate` in its cell instead of stretching the row past its header.
  const rowMinWidth = createMemo(() => `${columns().reduce((sum, { index }) => sum + (preferences.columnWidths[index] ?? 0), 0)}px`);
  const activeIndex = createMemo(() => {
    const id = activeRequestId();
    return id === null ? -1 : visibleRequests().findIndex((request) => request.id === id);
  });
  const activeRowRendered = createMemo(() => {
    const index = activeIndex();
    return index >= 0 && virtual.items().some((item) => item.index === index);
  });

  function moveTo(index: number, extendSelection: boolean) {
    selectRequest(index, { range: extendSelection });
    virtual.scrollToIndex(index);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== grid) return;
    const lastIndex = visibleRequests().length - 1;
    const pageRows = Math.max(1, Math.floor((grid.clientHeight - ROW_HEIGHT) / ROW_HEIGHT) - 1);
    const current = activeIndex();
    const targets: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      PageDown: current + pageRows,
      PageUp: current - pageRows,
      Home: 0,
      End: lastIndex,
    };
    if (event.key in targets) {
      event.preventDefault();
      if (lastIndex >= 0) moveTo(Math.max(0, Math.min(lastIndex, targets[event.key]!)), event.shiftKey);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllVisible();
    } else if (event.key === ' ' && current >= 0) {
      event.preventDefault();
      selectRequest(current, { toggle: true });
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && current >= 0) {
      event.preventDefault();
      const id = activeRequestId();
      const box = id === null ? undefined : document.getElementById(rowId(id))?.getBoundingClientRect();
      props.onRowMenu({ clientX: (box?.left ?? 0) + 40, clientY: box?.bottom ?? 0 });
    }
  }

  function onRowClick(event: MouseEvent, index: number) {
    selectRequest(index, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
    grid?.focus({ preventScroll: true });
  }

  function onRowContextMenu(event: MouseEvent, index: number, request: Captured) {
    event.preventDefault();
    if (!isRequestSelected(request.id)) selectRequest(index);
    props.onRowMenu(event);
  }

  return (
    <div
      ref={(element) => (grid = element)}
      role="grid"
      aria-label={t('network.gridLabel')}
      aria-rowcount={visibleRequests().length + 1}
      aria-multiselectable="true"
      aria-activedescendant={activeRowRendered() ? rowId(activeRequestId()!) : undefined}
      tabindex="0"
      class="relative h-full min-h-0 flex-1 overflow-auto -outline-offset-2 select-none"
      onKeyDown={onKeyDown}
      onScroll={() => (followEnd = nearEnd())}
    >
      <div role="rowgroup" class="sticky top-0 z-10">
        <div
          role="row"
          aria-rowindex={1}
          class="grid w-full border-b border-line bg-bg-2"
          style={{ 'grid-template-columns': gridColumns(), 'min-width': rowMinWidth(), height: `${ROW_HEIGHT}px` }}
          onContextMenu={(event) => {
            event.preventDefault();
            openColumnsMenu(event);
          }}
        >
          <For each={columns()}>
            {(column) => (
              <div role="columnheader" class="relative truncate px-2 leading-[22px] font-semibold text-fg-2">
                {t(`network.columns.${column.key}`)}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('network.resizeColumn', { column: t(`network.columns.${column.key}`) })}
                  aria-valuenow={preferences.columnWidths[column.index]}
                  aria-valuemin={MIN_COLUMN_PX}
                  aria-valuemax={MAX_COLUMN_PX}
                  tabindex="0"
                  class="absolute end-0 top-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-accent focus-visible:bg-accent"
                  onPointerDown={(event) => startColumnResize(event, column.index)}
                  onKeyDown={(event) => onColumnResizeKey(event, column.index)}
                />
              </div>
            )}
          </For>
        </div>
      </div>

      <div role="rowgroup" class="relative" style={{ height: `${Math.max(0, virtual.totalSize() - ROW_HEIGHT)}px` }}>
        {/* rows are recycled by position (keyed={false}): scrolling only updates their text */}
        <For each={virtual.items()} keyed={false}>
          {(item) => {
            const index = () => item().index;
            const request = () => visibleRequests()[index()];
            return (
              <Show when={request()}>
                {(row) => (
                  <div
                    role="row"
                    id={rowId(row().id)}
                    aria-rowindex={index() + 2}
                    aria-selected={isRequestSelected(row().id) ? 'true' : 'false'}
                    class={[
                      'absolute start-0 top-0 grid w-full cursor-pointer border-b border-bg-3',
                      monoClass,
                      isRequestSelected(row().id) ? 'bg-sel' : index() % 2 ? 'bg-bg-2' : '',
                      { 'outline -outline-offset-1 outline-accent': activeRequestId() === row().id },
                    ]}
                    style={{
                      'grid-template-columns': gridColumns(),
                      'min-width': rowMinWidth(),
                      height: `${ROW_HEIGHT}px`,
                      transform: `translateY(${item().start - ROW_HEIGHT}px)`,
                    }}
                    onClick={(event) => onRowClick(event, index())}
                    onContextMenu={(event) => onRowContextMenu(event, index(), row())}
                  >
                    <For each={columns()}>
                      {(column) => (
                        <div
                          role="gridcell"
                          class="min-w-0 truncate px-2 leading-[22px]"
                          title={column.key === 'path' ? row().url : undefined}
                        >
                          <Switch fallback={column.text(row())}>
                            {/* same look as StatusBadge, inlined: no component per cell in the hottest list */}
                            <Match when={column.key === 'status'}>
                              <span class={BADGE_CLASS} style={badgeColors(`s-${statusToken(row().status, row().error)}`)}>
                                {column.text(row())}
                              </span>
                            </Match>
                            <Match when={column.key === 'method'}>
                              <span class={BADGE_CLASS} style={badgeColors(`m-${methodToken(row().method)}`)}>
                                {row().method}
                              </span>
                            </Match>
                          </Switch>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            );
          }}
        </For>
      </div>

      <Show when={!visibleRequests().length}>
        <div class="absolute inset-x-0 top-12 px-6 text-center text-fg-2">
          <Switch
            fallback={
              <>
                {t('network.emptyWaiting')}
                <Show when={import.meta.env.FIREFOX}>
                  <br />
                  {t('network.emptyFirefox')}
                </Show>
              </>
            }
          >
            <Match when={capturedCount()}>{t('network.emptyNoMatch', { query: filterText() })}</Match>
            <Match when={!attachedToDevtools}>{t('network.emptyNotAttached')}</Match>
            <Match when={!isRecording()}>{t('network.emptyPaused')}</Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}
