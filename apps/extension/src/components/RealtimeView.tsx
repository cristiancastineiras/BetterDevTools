import {
  formatBytes,
  groupSessions,
  realtimeMatcher,
  type RealtimeEvent,
  type RealtimeKind,
  type RealtimeSession,
} from '@betterdevtools/core';
import { createMemo, createUniqueId, For, Match, onSettled, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { attachedToDevtools } from '../state/capture.ts';
import { preferences, updatePreferences } from '../state/preferences.ts';
import {
  clearRealtime,
  realtimeEvents,
  realtimeFilter,
  realtimeProblem,
  realtimeRecording,
  reloadAndCapture,
  selectedSessionId,
  setRealtimeFilter,
  setSelectedSessionId,
  startRealtime,
  toggleRealtimeRecording,
} from '../state/realtime.ts';
import { download } from '../lib/io.ts';
import Composer, { createPicker, PickBox } from './RealtimeActions.tsx';
import DiffView from './DiffView.tsx';
import SplitView from './SplitView.tsx';
import CopyButton from './ui/CopyButton.tsx';
import Icon from './ui/Icon.tsx';
import IconButton from './ui/IconButton.tsx';
import { BADGE_CLASS, badgeColors } from './ui/MethodBadge.tsx';
import { fieldClass, monoClass } from './ui/styles.ts';

/** Filter keys listed in the help popover (the syntax itself is not translated). */
const FILTER_EXAMPLES = 'kind:webrtc · kind:ws,sse · kind:bc,worker · kind:sw · kind:wt · state:open · is:error · -kind:worker · token';

// shortcut: renders the latest events of a session without virtualising; upgrade when sessions get longer
const MAX_SHOWN = 1000;

/** The colour pairs of the HTTP method tokens double as kind colours; the kind is always written out too. */
const KIND_TOKEN: Record<RealtimeKind, string> = {
  webrtc: 'm-post',
  broadcast: 'm-put',
  worker: 'm-patch',
  'service-worker': 'm-options',
  webtransport: 'm-get',
  websocket: 'm-connect',
  sse: 'm-trace',
};

const clock = (time: number): string => {
  const date = new Date(time);
  return `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};

/** JSON payloads are indented; anything else (SDP, text, base64) is shown as it came. */
function payload(event: RealtimeEvent): string {
  const data = event.data ?? '';
  if (event.binary || event.truncated || !/^\s*[[{]/.test(data)) return data;
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function KindBadge(props: { kind: RealtimeKind }) {
  return (
    <span class={BADGE_CLASS} style={badgeColors(KIND_TOKEN[props.kind])}>
      {t(`realtime.kinds.${props.kind}`)}
    </span>
  );
}

function SessionDetail(props: { session: RealtimeSession }) {
  const shown = createMemo(() => props.session.events.slice(-MAX_SHOWN));
  const picker = createPicker(() => props.session);
  return (
    <article aria-label={t('realtime.detailLabel')} class="flex h-full min-h-0 flex-col">
      <div class="flex items-start gap-1 border-b border-line p-1">
        <KindBadge kind={props.session.kind} />
        <span class={[monoClass, 'min-w-0 flex-1 [overflow-wrap:anywhere]']}>{props.session.label}</span>
        <span class="text-fg-2">{props.session.state}</span>
        <CopyButton
          label={t('realtime.copySession')}
          text={() =>
            JSON.stringify(
              { kind: props.session.kind, label: props.session.label, state: props.session.state, events: props.session.events },
              null,
              2,
            )
          }
        />
        <IconButton
          icon="export"
          label={t('realtime.export')}
          onClick={() =>
            download(
              `realtime-${props.session.kind}-${new Date(props.session.started).toISOString().replace(/[:.]/g, '-')}.json`,
              new Blob(
                [
                  JSON.stringify(
                    { kind: props.session.kind, label: props.session.label, state: props.session.state, events: props.session.events },
                    null,
                    2,
                  ),
                ],
                { type: 'application/json' },
              ),
            )
          }
        />
        <IconButton icon="close" label={t('realtime.closeDetail')} onClick={() => setSelectedSessionId(null)} />
      </div>
      <Composer session={props.session} />
      <Show when={picker.events().length === 2}>
        <div class="max-h-64 overflow-auto border-b border-line p-2" role="region" tabindex="0" aria-label={t('realtime.compare.title')}>
          <DiffView
            before={payload(picker.events()[0]!)}
            after={payload(picker.events()[1]!)}
            beforeLabel={t('realtime.compare.first')}
            afterLabel={t('realtime.compare.second')}
          />
        </div>
      </Show>
      <Show when={picker.picked().length < 2 && props.session.events.some((e) => e.type === 'message')}>
        <p class="border-b border-line px-2 py-1 text-fg-2">{t('realtime.compare.hint')}</p>
      </Show>
      {/* a scrolling area must take the keyboard, or its content cannot be read without a pointer */}
      <div
        role="region"
        tabindex="0"
        aria-label={t('realtime.eventsLabel', { count: formatNumber(props.session.events.length) })}
        class="min-h-0 flex-1 overflow-auto p-2"
      >
        <ol>
          <For each={shown()}>
            {(event) => (
              <li class="border-b border-bg-3 py-1">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <Show when={event.type === 'message' && event.data !== undefined && !event.binary}>
                    <PickBox event={event} checked={picker.picked().includes(event.seq)} onToggle={() => picker.toggle(event.seq)} />
                  </Show>
                  <span class={[monoClass, 'text-fg-2']}>{clock(event.time)}</span>
                  <Show when={event.dir}>
                    <span class="text-fg-2">
                      {event.dir === 'send' ? '↑' : '↓'}
                      <span class="sr-only">{t(`realtime.${event.dir === 'send' ? 'sent' : 'received'}`)}</span>
                    </span>
                  </Show>
                  <span class="font-semibold">{event.type}</span>
                  <Show when={event.part}>
                    <span class="text-fg-2">{event.part}</span>
                  </Show>
                  <Show when={event.detail}>
                    <span>{event.detail}</span>
                  </Show>
                  <Show when={event.size !== undefined && event.type === 'message'}>
                    <span class="text-fg-2">
                      {event.binary ? formatBytes(event.size ?? 0) : t('realtime.chars', { count: formatNumber(event.size ?? 0) })}
                    </span>
                  </Show>
                </div>
                <Show when={event.data}>
                  <pre class={[monoClass, 'mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]']}>
                    {event.binary ? `${t('realtime.base64')} ${payload(event)}` : payload(event)}
                  </pre>
                </Show>
                <Show when={event.truncated}>
                  <p class="text-warn" role="note">
                    {t('realtime.truncated')}
                  </p>
                </Show>
              </li>
            )}
          </For>
        </ol>
        <Show when={props.session.events.length > MAX_SHOWN}>
          <p class="mt-2 text-fg-2" role="note">
            {t('realtime.capped', { shown: MAX_SHOWN, total: formatNumber(props.session.events.length) })}
          </p>
        </Show>
      </div>
    </article>
  );
}

/** Realtime view: the channels the network list never shows, one row per connection, channel or worker. */
export default function RealtimeView() {
  const helpId = createUniqueId();
  onSettled(startRealtime);

  const sessions = createMemo(() => groupSessions(realtimeEvents()));
  const visible = createMemo(() => sessions().filter(realtimeMatcher(realtimeFilter())));
  const selected = createMemo(() => sessions().find((session) => session.id === selectedSessionId()));

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-line p-1">
        <IconButton
          icon={realtimeRecording() ? 'record' : 'pause'}
          label={realtimeRecording() ? t('realtime.pause') : t('realtime.resume')}
          text={realtimeRecording() ? t('network.record') : t('network.paused')}
          variant="record"
          pressed={realtimeRecording()}
          onClick={toggleRealtimeRecording}
        />
        <IconButton icon="clear" label={t('realtime.clear')} onClick={clearRealtime} />
        <span class="relative flex min-w-48 flex-1 items-center">
          <span class="pointer-events-none absolute start-1.5 inline-flex text-fg-2">
            <Icon name="filter" />
          </span>
          <input
            class={[fieldClass, monoClass, 'w-full ps-7']}
            type="search"
            autocomplete="off"
            spellcheck={false}
            aria-label={t('realtime.filterLabel')}
            aria-describedby={helpId}
            placeholder={t('realtime.filterPlaceholder')}
            value={realtimeFilter()}
            onInput={(event) => setRealtimeFilter(event.currentTarget.value)}
          />
        </span>
        <IconButton
          icon="replay"
          label={t('realtime.reloadHint')}
          text={t('realtime.reload')}
          disabled={!attachedToDevtools}
          onClick={reloadAndCapture}
        />
        <IconButton icon="help" label={t('realtime.filterHelp')} popovertarget={helpId} />
        <div
          id={helpId}
          popover="auto"
          class="fixed m-auto max-h-[calc(var(--vh)-1rem)] max-w-[min(32rem,calc(var(--vw)-1rem))] overflow-auto rounded-md border border-line bg-bg p-3 text-fg shadow-lg"
        >
          <p class="font-semibold">{t('realtime.filterHelpTitle')}</p>
          <p>{t('realtime.filterHelpText')}</p>
          <p class={[monoClass, 'mt-1']}>{FILTER_EXAMPLES}</p>
        </div>
      </div>
      <SplitView
        label={t('network.resizeDetail')}
        fraction={preferences.detailFraction}
        onResize={(fraction) =>
          updatePreferences((draft) => {
            draft.detailFraction = fraction;
          })
        }
        showSecond={selected() !== undefined}
        first={
          <div class="relative min-h-0 flex-1 overflow-auto">
            <Show when={visible().length}>
              <table class="w-full min-w-[34rem] border-collapse">
                <thead class="sticky top-0 z-10 bg-bg-2">
                  <tr class="border-b border-line">
                    <For each={['kind', 'name', 'state', 'messages', 'errors', 'started'] as const}>
                      {(column) => (
                        <th scope="col" class="px-2 text-start leading-[22px] font-semibold text-fg-2">
                          {t(`realtime.columns.${column}`)}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={visible()}>
                    {(session) => (
                      <tr
                        class={['cursor-pointer border-b border-bg-3', { 'bg-sel': session.id === selectedSessionId() }]}
                        aria-selected={session.id === selectedSessionId() ? 'true' : 'false'}
                        onClick={() => setSelectedSessionId(session.id)}
                      >
                        <td class="px-2 py-0.5">
                          <KindBadge kind={session.kind} />
                        </td>
                        <td class={[monoClass, 'max-w-0 min-w-40 px-2 py-0.5']}>
                          <button
                            type="button"
                            class="block w-full cursor-pointer truncate text-start"
                            title={session.label}
                            aria-current={session.id === selectedSessionId() ? 'true' : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedSessionId(session.id);
                            }}
                          >
                            {session.label}
                          </button>
                        </td>
                        <td class="px-2 py-0.5">{session.state || '—'}</td>
                        <td class={[monoClass, 'px-2 py-0.5 whitespace-nowrap']}>
                          <span aria-hidden="true">
                            ↑{formatNumber(session.sent)} ↓{formatNumber(session.received)}
                          </span>
                          <span class="sr-only">
                            {t('realtime.counts', { sent: formatNumber(session.sent), received: formatNumber(session.received) })}
                          </span>
                        </td>
                        <td class={['px-2 py-0.5', { 'text-bad': session.errors > 0 }]}>
                          {session.errors ? formatNumber(session.errors) : '—'}
                        </td>
                        <td class={[monoClass, 'px-2 py-0.5 whitespace-nowrap']}>{clock(session.started)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
            <Show when={!visible().length}>
              <div class="px-6 pt-12 text-center text-fg-2">
                <Switch fallback={t('realtime.empty')}>
                  <Match when={!attachedToDevtools}>{t('network.emptyNotAttached')}</Match>
                  <Match when={realtimeProblem()}>
                    <span class="text-warn" role="status">
                      {t('realtime.problem', { reason: realtimeProblem() })}
                    </span>
                  </Match>
                  <Match when={sessions().length}>{t('realtime.noMatch', { query: realtimeFilter() })}</Match>
                </Switch>
              </div>
            </Show>
          </div>
        }
        second={<Show when={selected()}>{(session) => <SessionDetail session={session()} />}</Show>}
      />
    </div>
  );
}
