import type { RealtimeEvent, RealtimeSession } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { sendRealtime } from '../lib/devtools.ts';
import { attachedToDevtools } from '../state/capture.ts';
import { announce } from '../state/ui.ts';
import IconButton from './ui/IconButton.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { fieldClass, monoClass } from './ui/styles.ts';

const SENDABLE = new Set(['websocket', 'broadcast', 'worker', 'webrtc']);
/** Gaps between replayed messages are capped, so a long-idle socket does not stall the replay. */
const MAX_REPLAY_GAP_MS = 2000;
const STRUCTURED = new Set(['broadcast', 'worker']);

const looksStructured = (text: string) => /^\s*[[{]/.test(text);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The messages the page sent that can be sent again: text and JSON, not cut short and not binary. */
export function replayable(session: RealtimeSession): RealtimeEvent[] {
  return session.events.filter((e) => e.type === 'message' && e.dir === 'send' && !e.binary && !e.truncated && e.data !== undefined);
}

/** Send a message through an object the page created, and replay what the page already sent. */
export default function Composer(props: { session: RealtimeSession }) {
  const [text, setText] = createSignal('');
  const [part, setPart] = createSignal('');
  const [asJson, setAsJson] = createSignal(false);
  const [keepTiming, setKeepTiming] = createSignal(true);
  const [status, setStatus] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const channels = createMemo(() => [...new Set(props.session.events.flatMap((e) => (e.part?.startsWith('channel "') ? [e.part] : [])))]);
  const target = () => (props.session.kind === 'webrtc' ? part() || channels()[0] || '' : '');
  const sent = createMemo(() => replayable(props.session));

  async function send(message: string, structured: boolean, to = target()) {
    const result = await sendRealtime(props.session.id, to, message, structured).catch((error: unknown) => ({
      ok: false,
      error: String(error),
    }));
    setStatus(
      result.ok
        ? { ok: true, text: t('realtime.send.sent') }
        : { ok: false, text: t('realtime.send.failed', { reason: result.error ?? '' }) },
    );
    return result.ok;
  }

  async function replay() {
    setBusy(true);
    let count = 0;
    let previous = sent()[0]?.time ?? 0;
    for (const event of sent()) {
      if (keepTiming()) await sleep(Math.min(MAX_REPLAY_GAP_MS, Math.max(0, event.time - previous)));
      previous = event.time;
      const data = event.data ?? '';
      if (
        !(await send(
          data,
          STRUCTURED.has(props.session.kind) && looksStructured(data),
          props.session.kind === 'webrtc' ? (event.part ?? '') : '',
        ))
      )
        break;
      count++;
    }
    setBusy(false);
    if (count) {
      setStatus({ ok: true, text: t('realtime.replay.done', { count: formatNumber(count) }) });
      announce(t('realtime.replay.done', { count: formatNumber(count) }));
    }
  }

  return (
    <Show when={SENDABLE.has(props.session.kind) && attachedToDevtools}>
      <div class="flex flex-col gap-1 border-b border-line p-2" role="group" aria-label={t('realtime.send.title')}>
        <div class="flex flex-wrap items-end gap-2">
          <Show when={props.session.kind === 'webrtc'}>
            <SelectMenu
              label={t('realtime.send.channel')}
              value={target()}
              onChange={setPart}
              options={
                channels().length
                  ? channels().map((value) => ({ value, label: value }))
                  : [{ value: '', label: t('realtime.send.noChannel'), disabled: true }]
              }
            />
          </Show>
          <label class="flex min-w-48 flex-1 flex-col gap-0.5">
            <span class="text-fg-2">{t('realtime.send.message')}</span>
            <textarea
              class={[fieldClass, monoClass, 'resize-y']}
              rows={2}
              spellcheck={false}
              value={text()}
              onInput={(event) => setText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text()) {
                  event.preventDefault();
                  void send(text(), asJson());
                }
              }}
            />
          </label>
          <Show when={STRUCTURED.has(props.session.kind)}>
            <IconButton
              icon="check"
              label={t('realtime.send.asJsonHint')}
              text={t('realtime.send.asJson')}
              pressed={asJson()}
              onClick={() => setAsJson(!asJson())}
            />
          </Show>
          <IconButton
            icon="send"
            variant="primary"
            label={t('realtime.send.hint')}
            text={t('realtime.send.button')}
            disabled={!text() || busy()}
            onClick={() => void send(text(), asJson())}
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <IconButton
            icon="replay"
            label={t('realtime.replay.hint')}
            text={t('realtime.replay.button', { count: formatNumber(sent().length) })}
            disabled={!sent().length || busy()}
            busy={busy()}
            onClick={() => void replay()}
          />
          <IconButton
            icon="check"
            label={t('realtime.replay.timing')}
            text={t('realtime.replay.timing')}
            pressed={keepTiming()}
            onClick={() => setKeepTiming(!keepTiming())}
          />
          <Show when={status()}>
            {(result) => (
              <span role="status" class={result().ok ? 'text-ok' : 'text-bad'}>
                {result().text}
              </span>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** Pick up to two messages of a session to compare; returns the picked events and the toggle. */
export function createPicker(session: () => RealtimeSession) {
  const [picked, setPicked] = createSignal<number[]>([]);
  const events = createMemo(() => picked().flatMap((seq) => session().events.filter((e) => e.seq === seq)));
  const toggle = (seq: number) => setPicked((now) => (now.includes(seq) ? now.filter((s) => s !== seq) : [...now, seq].slice(-2)));
  return { picked, events, toggle, clear: () => setPicked([]) };
}

export function PickBox(props: { event: RealtimeEvent; checked: boolean; onToggle: () => void }) {
  return (
    <label class="inline-flex items-center gap-1 text-fg-2">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggle}
        aria-label={t('realtime.compare.select', { type: props.event.type, time: new Date(props.event.time).toLocaleTimeString() })}
      />
    </label>
  );
}
