// Replay: the editable draft, sending it (from the inspected page or from the extension), the
// latest result and the local history.
import {
  assertReplayAllowed,
  base64ToBytes,
  bodyKind,
  buildRequest,
  carriesCredentials,
  draftFromEntry,
  emptyDraft,
  envVars,
  makeBody,
  type Body,
  type BuiltRequest,
  type Captured,
  type Draft,
} from '@betterdevtools/core';
import { createSignal, createStore, snapshot } from 'solid-js';
import * as v from 'valibot';
import { t } from '../i18n/index.ts';
import { db } from '../lib/db.ts';
import { devtoolsAvailable, fetchInInspectedPage, requestOrigin, withCookieHeader } from '../lib/devtools.ts';
import { bytesToBase64 } from '../lib/io.ts';
import { preferences } from './preferences.ts';
import { currentView, reportError, setCurrentView, setErrorMessage } from './ui.ts';
import { activeWorkspace } from './workspaces.ts';

const BodySchema = v.object({
  state: v.picklist(['available', 'truncated', 'empty', 'unavailable', 'discarded']),
  text: v.string(),
  encoding: v.optional(v.literal('base64')),
  size: v.number(),
  reason: v.optional(v.string()),
});
const ResultSchema = v.object({
  status: v.number(),
  statusText: v.string(),
  url: v.string(),
  redirected: v.boolean(),
  timeMs: v.number(),
  mime: v.string(),
  headers: v.array(v.object({ name: v.string(), value: v.string() })),
  body: BodySchema,
  error: v.string(),
  /** Where the replay was sent from (older records have none). */
  sentFrom: v.optional(v.picklist(['page', 'extension'])),
});
const HistoryRecordSchema = v.object({
  id: v.optional(v.number()),
  at: v.number(),
  draft: v.object({
    method: v.string(),
    url: v.string(),
    query: v.string(),
    headers: v.string(),
    body: v.string(),
    credentials: v.boolean(),
    sourceId: v.nullable(v.number()),
  }),
  result: ResultSchema,
});
export type ReplayResult = v.InferOutput<typeof ResultSchema>;
export type HistoryRecord = v.InferOutput<typeof HistoryRecordSchema>;
export type ReplayTab = 'query' | 'headers' | 'body' | 'cookies';
export type SendFrom = 'page' | 'extension';

const HISTORY_LIMIT = 200;
const HISTORY_BODY_CHARS = 256 * 1024;

export const [replayDraft, setReplayDraftStore] = createStore<Draft>(emptyDraft());
export const [replayTab, setReplayTab] = createSignal<ReplayTab>('headers');
export const [replayResult, setReplayResult] = createSignal<ReplayResult | null>(null);
export const [replayHistory, setReplayHistory] = createSignal<HistoryRecord[]>([]);
export const [isSending, setIsSending] = createSignal(false);

/** Sending from the inspected page needs the panel to be inside DevTools. */
export const canSendFromPage = devtoolsAvailable();

/** Where a send goes from: edited cookies need the extension's network rule. */
export function effectiveSendFrom(draft: Pick<Draft, 'sendCookies' | 'cookies'> = replayDraft): SendFrom {
  if (!canSendFromPage || (draft.sendCookies && draft.cookies.length > 0)) return 'extension';
  return preferences.sendFrom;
}

export function editReplayDraft(change: (draft: Draft) => void): void {
  setReplayDraftStore(change);
}

/** Opens the Replay view with a draft built from a captured request (credentials left out). */
export function openReplay(request: Captured, tab: ReplayTab = 'headers'): void {
  setReplayDraftStore(() => draftFromEntry(request.har, request.id));
  setReplayResult(null);
  setReplayTab(tab);
  if (currentView() !== 'replay') setCurrentView('replay');
}

/** Opens a saved request (collections) in the Replay view. */
export function openSavedRequest(saved: Pick<Draft, 'method' | 'url' | 'query' | 'headers' | 'body'>): void {
  setReplayDraftStore(() => ({ ...emptyDraft(), ...saved }));
  setReplayResult(null);
  setCurrentView('replay');
}

export function loadHistoryRecord(record: HistoryRecord): void {
  setReplayDraftStore(() => ({ ...record.draft, credentialHeaders: [], cookies: [], sendCookies: false }));
  setReplayResult(record.result);
}

export async function loadReplayHistory(): Promise<void> {
  const stored = await db.all('replays');
  setReplayHistory(
    stored
      .flatMap((record) => {
        const parsed = v.safeParse(HistoryRecordSchema, record);
        return parsed.success ? [parsed.output] : [];
      })
      .reverse(),
  );
}

// ------------------------------------------------------------------------------- sending

let sendInProgress = false; // checked synchronously: a double Ctrl+Enter must not send twice
let currentSend: AbortController | null = null;

export function cancelReplay(): void {
  currentSend?.abort();
}

/** Turns response bytes into a Body: binary types stay base64, text is decoded. */
function bodyFromBytes(bytes: Uint8Array, mime: string, truncated: boolean, maxBytes: number): Body {
  const binary = bodyKind(mime, 'base64') === 'binary' || bodyKind(mime) === 'image';
  const body = binary
    ? makeBody(bytesToBase64(bytes), 'base64', bytes.length)
    : makeBody(new TextDecoder().decode(bytes), undefined, bytes.length);
  return truncated ? { ...body, state: 'truncated', reason: t('replay.truncatedAt', { bytes: maxBytes }) } : body;
}

/** Reads a fetch() response up to `maxBytes`. */
async function readResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (!reader) return { bytes: new Uint8Array(0), truncated };
  for (;;) {
    signal.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

/** Sends from the extension origin (asks for site access first so CORS does not block reading). */
async function sendFromExtension(request: BuiltRequest, maxBytes: number, signal: AbortSignal, started: number): Promise<ReplayResult> {
  const access = await requestOrigin(request.url);
  const go = () =>
    fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: request.credentials,
      redirect: 'follow',
      cache: 'no-store',
      signal,
    });
  try {
    const response = request.cookieHeader ? await withCookieHeader(request.url, request.cookieHeader, go) : await go();
    const mime = response.headers.get('content-type') ?? '';
    const { bytes, truncated } = await readResponse(response, maxBytes, signal);
    return {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      redirected: response.redirected,
      timeMs: Math.round(performance.now() - started),
      mime,
      headers: [...response.headers].map(([name, value]) => ({ name, value })),
      body: bodyFromBytes(bytes, mime, truncated, maxBytes),
      error: '',
      sentFrom: 'extension',
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const hint = access === false ? t('replay.failedPermissionRefused') : access === null ? t('replay.failedCors') : '';
    throw new Error(`${String(error)}${hint}`, { cause: error });
  }
}

/** Sends from the inspected page: same origin and CORS as the request that was captured. */
async function sendFromPage(request: BuiltRequest, maxBytes: number, signal: AbortSignal, started: number): Promise<ReplayResult> {
  const answer = await fetchInInspectedPage(request, maxBytes, signal);
  const headers = answer.headers.map(([name, value]) => ({ name, value }));
  const mime = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  return {
    status: answer.status,
    statusText: answer.statusText,
    url: answer.url,
    redirected: answer.redirected,
    timeMs: Math.round(performance.now() - started),
    mime,
    headers,
    body: bodyFromBytes(base64ToBytes(answer.base64), mime, answer.truncated, maxBytes),
    error: '',
    sentFrom: 'page',
  };
}

/**
 * Sends the current draft. Mutating methods and anything carrying credentials must arrive here
 * with confirmed=true (from the confirmation dialog); the guard in core enforces it.
 */
export async function sendReplay(confirmed: boolean): Promise<void> {
  if (sendInProgress) return;
  const draft = snapshot(replayDraft);
  const built = buildRequest(draft, envVars(activeWorkspace()));
  if ('error' in built) {
    reportError(built.error);
    return;
  }
  const request = built.request;
  assertReplayAllowed(request.method, confirmed, carriesCredentials(draft));
  const from = effectiveSendFrom(draft);
  const maxBytes = snapshot(preferences).maxBodyKB * 1024;
  sendInProgress = true;
  setIsSending(true);
  setErrorMessage('');
  const controller = new AbortController();
  currentSend = controller;
  const started = performance.now();
  let result: ReplayResult;
  try {
    result =
      from === 'page'
        ? await sendFromPage(request, maxBytes, controller.signal, started)
        : await sendFromExtension(request, maxBytes, controller.signal, started);
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    result = {
      status: 0,
      statusText: '',
      url: request.url,
      redirected: false,
      timeMs: Math.round(performance.now() - started),
      mime: '',
      headers: [],
      body: makeBody(null, undefined, 0, t('replay.noResponse')),
      error: cancelled ? t('replay.cancelled') : error instanceof Error ? error.message : String(error),
      sentFrom: from,
    };
  } finally {
    sendInProgress = false;
    currentSend = null;
    setIsSending(false);
  }
  setReplayResult(result);
  await addToHistory(draft, result);
}

/** Stores the replay; credentials and edited cookies never go to storage. */
async function addToHistory(draft: Draft, result: ReplayResult): Promise<void> {
  const { credentialHeaders: _credentials, cookies: _cookies, sendCookies: _sendCookies, ...storable } = draft;
  const body =
    result.body.text.length > HISTORY_BODY_CHARS
      ? { ...result.body, state: 'truncated' as const, text: result.body.text.slice(0, HISTORY_BODY_CHARS) }
      : result.body;
  const record: HistoryRecord = { at: Date.now(), draft: storable, result: { ...result, body } };
  try {
    const id = await db.put('replays', record);
    await db.trim('replays', HISTORY_LIMIT);
    setReplayHistory((list) => [{ ...record, id: typeof id === 'number' ? id : undefined }, ...list].slice(0, HISTORY_LIMIT));
  } catch (error) {
    reportError(t('status.saveHistoryFailed'), error);
  }
}
