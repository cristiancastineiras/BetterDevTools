// API AutoDiscovery: the session being recorded, its saved copies and the actions on it.
// The model (packages/core) lives outside Solid's reactivity; `discoveryVersion` tells views when
// it changed, at most a few times a second while traffic pours in.
import { buildExport, DiscoveryModel, diffSessions, type DiscoveryExportFormat, type SessionDiff } from '@betterdevtools/core';
import { createSignal } from 'solid-js';
import { t } from '../i18n/index.ts';
import { db } from '../lib/db.ts';
import { download, logEvent } from '../lib/io.ts';
import { captureLog, onPageNavigated, onRequestsAdded } from './capture.ts';
import { announce, reportError } from './ui.ts';

export type DiscoveryStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface SavedSession {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  endpoints: number;
  seen: number;
}

const INDEX_KEY = 'discovery:index';
const sessionKey = (id: string) => `discovery:s:${id}`;
const MAX_SAVED = 20;
const VERSION_DELAY_MS = 250;
const SAVE_DELAY_MS = 5_000;

let model: DiscoveryModel | null = null;
const [discoveryVersion, setDiscoveryVersion] = createSignal(0);
const [status, setStatus] = createSignal<DiscoveryStatus>('idle');
const [elapsedMs, setElapsedMs] = createSignal(0);
const [savedSessions, setSavedSessions] = createSignal<SavedSession[]>([]);
const [comparison, setComparison] = createSignal<{ name: string; diff: SessionDiff } | null>(null);
export { comparison, discoveryVersion, elapsedMs, savedSessions, status as discoveryStatus };

/** The current model; read inside a view's memo together with `discoveryVersion()`. */
export const currentModel = (): DiscoveryModel | null => {
  discoveryVersion();
  return model;
};

let versionTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let activeSince = 0;

function bump(now = false): void {
  if (now) {
    clearTimeout(versionTimer);
    versionTimer = undefined;
    setDiscoveryVersion((n) => n + 1);
    return;
  }
  versionTimer ??= setTimeout(() => {
    versionTimer = undefined;
    setDiscoveryVersion((n) => n + 1);
  }, VERSION_DELAY_MS);
}

// ---------------------------------------------------------------------------------- clock

function startClock(): void {
  activeSince = Date.now();
  clearInterval(tick);
  tick = setInterval(() => model && setElapsedMs(model.state.activeMs + Date.now() - activeSince), 1000);
}

function stopClock(): void {
  clearInterval(tick);
  tick = undefined;
  if (model && activeSince) model.state.activeMs += Date.now() - activeSince;
  activeSince = 0;
  if (model) setElapsedMs(model.state.activeMs);
}

// ------------------------------------------------------------------------------ recording

function watch(): void {
  if (watching) return;
  watching = true;
  onRequestsAdded((added) => {
    if (status() !== 'recording' || !model) return;
    for (const call of added) model.observe(call, captureLog.body(call.id));
    bump();
    scheduleSave();
  });
  onPageNavigated((url) => {
    if (status() !== 'recording' || !model) return;
    const path = URL.parse(url);
    model.startScenario(t('discovery.navigatedTo', { page: path ? path.pathname + path.search : url }));
    bump();
  });
}
let watching = false;

/** Starts a new session; what was being recorded is saved first. */
export function startRecording(name?: string): void {
  watch();
  if (model && status() !== 'idle') void persist();
  model = DiscoveryModel.create(name?.trim() || t('discovery.defaultName', { date: new Date().toLocaleString() }));
  setComparison(null);
  setElapsedMs(0);
  setStatus('recording');
  startClock();
  bump(true);
  announce(t('discovery.statusRecording'));
}

export function pauseRecording(): void {
  if (status() !== 'recording') return;
  stopClock();
  setStatus('paused');
  void persist();
  announce(t('discovery.statusPaused'));
}

export function resumeRecording(): void {
  if (status() !== 'paused') return;
  startClock();
  setStatus('recording');
  announce(t('discovery.statusRecording'));
}

/** Ends the session: endpoints that differ only by one value are merged where there is evidence, then it is saved. */
export function stopAndAnalyze(): void {
  if (!model || (status() !== 'recording' && status() !== 'paused')) return;
  if (status() === 'recording') stopClock();
  const merged = model.consolidate();
  model.state.endedAt = Date.now();
  setStatus('stopped');
  bump(true);
  void persist();
  announce(t('discovery.analyzed', { endpoints: model.endpoints().length, merged }));
}

/** Builds a session from the requests already in the Network view, without recording anything new. */
export function analyzeCapturedTraffic(): void {
  watch();
  if (model && status() !== 'idle') void persist();
  model = DiscoveryModel.create(t('discovery.capturedName', { date: new Date().toLocaleString() }));
  setComparison(null);
  const started = performance.now();
  for (const call of captureLog.entries) model.observe(call, captureLog.body(call.id));
  model.consolidate();
  model.state.endedAt = Date.now();
  model.state.activeMs = Math.round(performance.now() - started);
  setElapsedMs(model.state.activeMs);
  setStatus('stopped');
  bump(true);
  void persist();
  announce(t('discovery.analyzedCapture', { requests: captureLog.entries.length, endpoints: model.endpoints().length }));
}

export function markScenario(name: string): void {
  const text = name.trim();
  if (!model || !text) return;
  model.startScenario(text);
  bump(true);
}

export function freezeContract(): void {
  if (!model) return;
  const endpoints = model.freeze();
  bump(true);
  announce(t('discovery.frozen', { count: endpoints }));
  void persist();
}

export function unfreezeContract(): void {
  model?.unfreeze();
  bump(true);
  void persist();
}

/** Drops the current session (its saved copy stays). */
export function closeSession(): void {
  if (status() === 'recording') stopClock();
  model = null;
  setComparison(null);
  setStatus('idle');
  setElapsedMs(0);
  bump(true);
}

// ----------------------------------------------------------------------------- persistence

function summary(session: DiscoveryModel): SavedSession {
  const { id, name, startedAt, endedAt, seen } = session.state;
  return { id, name, startedAt, endedAt, seen, endpoints: Object.keys(session.state.endpoints).length };
}

function scheduleSave(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    void persist();
  }, SAVE_DELAY_MS);
}

async function persist(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const session = model;
  if (!session) return;
  try {
    await db.put('kv', structuredClone(session.toJSON()), sessionKey(session.state.id));
    const index = [summary(session), ...savedSessions().filter((entry) => entry.id !== session.state.id)];
    const kept = index.slice(0, MAX_SAVED);
    for (const dropped of index.slice(MAX_SAVED)) await db.delete('kv', sessionKey(dropped.id));
    await db.put('kv', kept, INDEX_KEY);
    setSavedSessions(kept);
  } catch (error) {
    reportError(t('discovery.saveFailed'), error);
  }
}

export async function loadSavedList(): Promise<void> {
  try {
    const stored = await db.get('kv', INDEX_KEY);
    if (Array.isArray(stored)) setSavedSessions(stored as SavedSession[]);
  } catch (error) {
    logEvent('warn', 'discovery.index', { error: String(error) });
  }
}

export async function openSavedSession(id: string): Promise<void> {
  try {
    const loaded = DiscoveryModel.fromJSON(await db.get('kv', sessionKey(id)));
    if (!loaded) {
      reportError(t('discovery.loadFailed'));
      return;
    }
    watch();
    if (status() === 'recording') stopClock();
    model = loaded;
    setComparison(null);
    setElapsedMs(loaded.state.activeMs);
    setStatus('stopped');
    bump(true);
  } catch (error) {
    reportError(t('discovery.loadFailed'), error);
  }
}

export async function deleteSavedSession(id: string): Promise<void> {
  try {
    await db.delete('kv', sessionKey(id));
    const kept = savedSessions().filter((entry) => entry.id !== id);
    await db.put('kv', kept, INDEX_KEY);
    setSavedSessions(kept);
  } catch (error) {
    reportError(t('discovery.saveFailed'), error);
  }
}

/** What changed between a saved session (before) and the current one. */
export async function compareWithSaved(id: string): Promise<void> {
  if (!model) return;
  try {
    const before = DiscoveryModel.fromJSON(await db.get('kv', sessionKey(id)));
    if (!before) return reportError(t('discovery.loadFailed'));
    setComparison({ name: before.state.name, diff: diffSessions(before, model) });
  } catch (error) {
    reportError(t('discovery.loadFailed'), error);
  }
}

export function clearComparison(): void {
  setComparison(null);
}

// ---------------------------------------------------------------------------------- export

export function exportSession(format: DiscoveryExportFormat): void {
  if (!model) return;
  try {
    const file = buildExport(model, format);
    download(file.name, new Blob([file.bytes.slice().buffer], { type: file.mime }));
    announce(t('discovery.exported', { name: file.name }));
  } catch (error) {
    reportError(t('discovery.exportFailed'), error);
  }
}
