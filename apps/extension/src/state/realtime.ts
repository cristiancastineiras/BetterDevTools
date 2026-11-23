// Realtime channels (WebRTC, BroadcastChannel, workers, Service Workers, WebTransport): a hook in the
// inspected page buffers their events, and this module drains the buffer on a short timer. The
// timer is the only way in: inspectedWindow.eval is the one door a DevTools panel has to the page.
import { MAX_REALTIME_EVENTS, parseRealtimeDrain, type RealtimeEvent } from '@betterdevtools/core';
import { createSignal, snapshot } from 'solid-js';
import { drainRealtime, installRealtimeHook, reloadInspectedPage } from '../lib/devtools.ts';
import { logEvent } from '../lib/io.ts';
import { attachedToDevtools, onPageNavigated } from './capture.ts';
import { preferences } from './preferences.ts';
import { currentView } from './ui.ts';

const [realtimeEvents, setRealtimeEvents] = createSignal<RealtimeEvent[]>([]);
const [realtimeRecording, setRealtimeRecording] = createSignal(true);
const [realtimeFilter, setRealtimeFilter] = createSignal('');
const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
/** Why the page cannot be watched right now (a browser page, a closed DevTools), or empty. */
const [realtimeProblem, setRealtimeProblem] = createSignal('');
export { realtimeEvents, realtimeFilter, realtimeProblem, realtimeRecording, selectedSessionId, setRealtimeFilter, setSelectedSessionId };

const VISIBLE_POLL_MS = 400;
const BACKGROUND_POLL_MS = 2000;
const FAILURE_POLL_MS = 3000;

let started = false;
let epoch = '';
let cursor = 0;

export function toggleRealtimeRecording(): void {
  setRealtimeRecording(!realtimeRecording());
}

export function clearRealtime(): void {
  setRealtimeEvents([]);
  setSelectedSessionId(null);
}

/** Reloads the inspected page with the hook in place before its scripts run, to see what it opens while loading. */
export function reloadAndCapture(): void {
  reloadInspectedPage(true);
}

function accept(events: RealtimeEvent[]): void {
  if (!events.length) return;
  // a new array each time, so the list can compare by reference
  setRealtimeEvents((previous) => previous.concat(events).slice(-MAX_REALTIME_EVENTS));
}

async function tick(): Promise<void> {
  let wait = currentView() === 'realtime' ? VISIBLE_POLL_MS : BACKGROUND_POLL_MS;
  try {
    const reply = parseRealtimeDrain(await drainRealtime(epoch, cursor));
    if (reply) {
      if (reply.epoch !== epoch) {
        epoch = reply.epoch; // a new page: its sequence starts over
        cursor = 0;
      }
      const last = reply.events.at(-1);
      if (last) cursor = last.seq;
      // paused: the page's buffer is still emptied, so it cannot fill up while nobody looks
      if (realtimeRecording()) accept(reply.events);
      if (reply.skipped) logEvent('warn', 'realtime.invalid', { skipped: reply.skipped });
    } else {
      await installRealtimeHook();
    }
    setRealtimeProblem('');
  } catch (error) {
    setRealtimeProblem(error instanceof Error ? error.message : String(error));
    wait = FAILURE_POLL_MS;
  }
  setTimeout(() => void tick(), wait);
}

/** Installs the hook in the inspected page and starts draining it. Safe to call again. */
export function startRealtime(): void {
  if (started || !attachedToDevtools) return;
  started = true;
  onPageNavigated(() => {
    if (!snapshot(preferences).preserveLog) clearRealtime();
  });
  void tick();
}
