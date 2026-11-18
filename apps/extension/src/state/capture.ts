// Captured traffic: the capture pipeline from DevTools, the filtered list, the selection and the
// request shown in the details pane. Entries and bodies live in a CaptureLog outside Solid's
// reactivity; signals only mirror what the UI needs (the visible rows and a few counters).
import { CaptureLog, HarEntrySchema, takeBody, type Body, type Captured, type HarEntry, type Source } from '@betterdevtools/core';
import { createSignal, snapshot } from 'solid-js';
import * as v from 'valibot';
import { devtoolsAvailable, readContent, recordedEntries, startCapture } from '../lib/devtools.ts';
import { logEvent } from '../lib/io.ts';
import { preferences } from './preferences.ts';

export const captureLog = new CaptureLog();
export const attachedToDevtools = devtoolsAvailable();

// The rows array is replaced (never mutated) on every change, so the list can compare by reference.
const [visibleRequests, setVisibleRequests] = createSignal<Captured[]>([], { equals: false });
const [capturedCount, setCapturedCount] = createSignal(0);
/** Bumped whenever bodies may have changed (new entries, eviction, memory budget). */
const [bodiesVersion, setBodiesVersion] = createSignal(0);
const [isRecording, setIsRecording] = createSignal(true);
const [filterText, setFilterText] = createSignal('');
const [filterDurationMs, setFilterDurationMs] = createSignal(0);
const [malformedCount, setMalformedCount] = createSignal(0);
export { bodiesVersion, capturedCount, filterDurationMs, filterText, isRecording, malformedCount, visibleRequests };

function publishLogState(): void {
  setVisibleRequests(captureLog.view);
  setCapturedCount(captureLog.entries.length);
  setBodiesVersion((n) => n + 1);
}

// ----------------------------------------------------------------------------- recording

let recording = true; // mirror read by capture callbacks without waiting for a flush

export function toggleRecording(): boolean {
  recording = !recording;
  setIsRecording(recording);
  return recording;
}

/** Applies the ring-buffer and body-memory limits from the preferences. */
export function applyCaptureLimits(): void {
  const { capacity, maxBodyKB, bodyBudgetMB } = snapshot(preferences);
  captureLog.setLimits({ capacity, maxBodyChars: maxBodyKB * 1024, maxTotalBodyChars: bodyBudgetMB * 1048576 });
  publishLogState();
}

// Bursts of finished requests are added together, at most every 60 ms. A timer (not
// requestAnimationFrame) keeps draining while the DevTools panel is hidden.
const FLUSH_DELAY_MS = 60;
let pendingEntries: { har: HarEntry; body: Body; source: Source }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let malformed = 0;
/** Bumped by clearRequests(): body reads still in flight from before the clear are dropped. */
let clearGeneration = 0;
/** While the backfill is pending, keys of live entries, so the backfill can skip them. */
let liveKeysDuringBackfill: Set<string> | null = null;

function enqueue(entry: { har: HarEntry; body: Body; source: Source }): void {
  pendingEntries.push(entry);
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    captureLog.add(pendingEntries);
    pendingEntries = [];
    publishLogState();
  }, FLUSH_DELAY_MS);
}

const entryKey = (har: HarEntry) => `${har.startedDateTime} ${har.request.method} ${har.request.url}`;

/** Validates one entry handed over by DevTools and queues it once its body has been read. */
function capture(raw: unknown, source: Source, skipKeys?: Set<string>): void {
  if (!recording) return;
  const parsed = v.safeParse(HarEntrySchema, raw);
  if (!parsed.success) {
    setMalformedCount(++malformed);
    logEvent('warn', 'capture.invalid', { issue: parsed.issues[0].message });
    return;
  }
  const { har, body: inlineBody } = takeBody(parsed.output);
  // getHAR() also lists requests still in flight (status 0, no error); onRequestFinished delivers them later
  if (source === 'backfill' && har.response.status === 0 && !har.response._error) return;
  const key = entryKey(har);
  if (skipKeys?.has(key)) return;
  liveKeysDuringBackfill?.add(key);
  const generation = clearGeneration;
  // bodies are read right away: DevTools forgets them on navigation
  const body = inlineBody.state === 'available' ? Promise.resolve(inlineBody) : readContent(raw, har.response.content.size);
  void body.then((readBody) => {
    if (generation === clearGeneration) enqueue({ har, body: readBody, source });
  });
}

/** Starts listening to DevTools and adds what it recorded before the panel opened. */
export function startDevtoolsCapture(): void {
  if (!attachedToDevtools) return;
  startCapture({
    onRequest: (raw) => capture(raw, 'live'),
    onNavigated: () => {
      if (!snapshot(preferences).preserveLog) clearRequests();
    },
  });
  // requests finishing between listener registration and getHAR() arrive both ways: keep the live copy
  liveKeysDuringBackfill = new Set();
  void recordedEntries().then((entries) => {
    const liveKeys = liveKeysDuringBackfill ?? undefined;
    liveKeysDuringBackfill = null;
    for (const raw of entries) capture(raw, 'backfill', liveKeys);
  });
}

/** Adds entries from an imported HAR file. */
export function addImportedEntries(entries: HarEntry[]): void {
  captureLog.add(entries.map((entry) => ({ ...takeBody(entry), source: 'import' as const })));
  publishLogState();
}

export function clearRequests(): void {
  clearGeneration++;
  pendingEntries = [];
  captureLog.clear();
  selectedIds.clear();
  bumpSelection();
  setActiveRequestId(null);
  publishLogState();
}

// --------------------------------------------------------------------------------- filter

const FILTER_DEBOUNCE_MS = 120;
let filterTimer: ReturnType<typeof setTimeout> | undefined;

/** Updates the filter text now and the filtered rows after a short pause in typing. */
export function setFilter(query: string): void {
  setFilterText(query);
  clearTimeout(filterTimer);
  filterTimer = setTimeout(refilter, FILTER_DEBOUNCE_MS, query);
}

/** Runs the filter again, e.g. after "search bodies" was toggled. */
export function refilter(query = captureLog.query): void {
  const started = performance.now();
  captureLog.setQuery(query, snapshot(preferences).searchBodies);
  setFilterDurationMs(Math.round((performance.now() - started) * 10) / 10);
  publishLogState();
}

// ------------------------------------------------------------------------------ selection

// The selected ids live in a plain Set; a version signal tells the UI when it changed.
const selectedIds = new Set<number>();
const [selectionVersion, setSelectionVersion] = createSignal(0);
const bumpSelection = () => setSelectionVersion((n) => n + 1);
let selectionAnchorId: number | null = null;

const [activeRequestId, setActiveRequestIdSignal] = createSignal<number | null>(null);
let activeId: number | null = null; // mirror for code that runs right after a change
export { activeRequestId };

export function setActiveRequestId(id: number | null): void {
  activeId = id;
  setActiveRequestIdSignal(id);
}

/** The request shown in the details pane (null when none or when it left the ring buffer). */
export function activeRequest(): Captured | null {
  capturedCount();
  const id = activeRequestId();
  return id === null ? null : (captureLog.get(id) ?? null);
}

export function isRequestSelected(id: number): boolean {
  selectionVersion();
  return selectedIds.has(id);
}

export function selectedCount(): number {
  selectionVersion();
  return selectedIds.size;
}

/**
 * Selects the row at `index` of the visible list: a plain click selects only it, `toggle`
 * (Ctrl/Cmd) adds or removes it, `range` (Shift) selects everything from the anchor row.
 */
export function selectRequest(index: number, mode: { toggle?: boolean; range?: boolean } = {}): void {
  const rows = captureLog.view;
  const request = rows[index];
  if (!request) return;
  const anchorIndex = mode.range && selectionAnchorId !== null ? rows.findIndex((r) => r.id === selectionAnchorId) : -1;
  if (anchorIndex >= 0) {
    if (!mode.toggle) selectedIds.clear();
    const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
    for (let i = from; i <= to; i++) selectedIds.add(rows[i]!.id);
  } else {
    if (!mode.toggle) selectedIds.clear();
    if (mode.toggle && selectedIds.has(request.id)) selectedIds.delete(request.id);
    else selectedIds.add(request.id);
    selectionAnchorId = request.id;
  }
  bumpSelection();
  setActiveRequestId(request.id);
}

export function selectAllVisible(): void {
  for (const request of captureLog.view) selectedIds.add(request.id);
  bumpSelection();
}

export function clearSelection(): void {
  if (!selectedIds.size) return;
  selectedIds.clear();
  bumpSelection();
}

/** Selected requests in list order, or the active request when nothing is selected. Not reactive. */
export function selectedRequests(): Captured[] {
  const picked = captureLog.view.filter((r) => selectedIds.has(r.id));
  if (picked.length) return picked;
  const active = activeId === null ? undefined : captureLog.get(activeId);
  return active ? [active] : [];
}
