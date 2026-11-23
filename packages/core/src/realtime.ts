import * as v from 'valibot';

// Realtime channels the network panel never lists: WebRTC, BroadcastChannel, Worker, Service Worker
// and WebTransport. A hook in the inspected page (realtime-hook.ts) reports their events; this
// module validates them (the page is untrusted), groups them into sessions and filters them.

export const REALTIME_KINDS = ['webrtc', 'broadcast', 'worker', 'service-worker', 'webtransport', 'websocket', 'sse'] as const;
export type RealtimeKind = (typeof REALTIME_KINDS)[number];

/** Events kept in the panel; the oldest are dropped beyond it. */
export const MAX_REALTIME_EVENTS = 10_000;

const text = v.pipe(v.string(), v.maxLength(32_768));

const RealtimeEventSchema = v.object({
  seq: v.number(),
  /** Session the event belongs to: one peer connection, channel, worker, registration or transport. */
  id: v.pipe(v.string(), v.maxLength(100)),
  kind: v.picklist(REALTIME_KINDS),
  /** Milliseconds since the epoch, taken in the page. */
  time: v.number(),
  /** create, open, close, error, state, message, sdp, candidate, stream, call */
  type: v.pipe(v.string(), v.maxLength(40)),
  dir: v.optional(v.picklist(['send', 'receive'])),
  /** Sub-resource inside the session: a data channel, a stream, the ICE state. */
  part: v.optional(v.pipe(v.string(), v.maxLength(200))),
  label: v.optional(text),
  detail: v.optional(text),
  data: v.optional(text),
  /** Size of the original payload, which `data` may show only in part. */
  size: v.optional(v.number()),
  binary: v.optional(v.boolean()),
  truncated: v.optional(v.boolean()),
});

export type RealtimeEvent = v.InferOutput<typeof RealtimeEventSchema>;

export interface RealtimeDrain {
  /** Identifies one installation of the hook (one page load); the sequence restarts with a new one. */
  epoch: string;
  events: RealtimeEvent[];
  /** Events that did not look like events and were dropped. */
  skipped: number;
}

/** Reads what the page's hook returned. Null means the hook is not installed (a new page, or never). */
export function parseRealtimeDrain(raw: unknown): RealtimeDrain | null {
  const top = v.safeParse(v.object({ epoch: v.string(), events: v.array(v.unknown()) }), raw);
  if (!top.success) return null;
  const events: RealtimeEvent[] = [];
  for (const candidate of top.output.events) {
    const event = v.safeParse(RealtimeEventSchema, candidate);
    if (event.success) events.push(event.output);
  }
  return { epoch: top.output.epoch, events, skipped: top.output.events.length - events.length };
}

export interface RealtimeSession {
  id: string;
  kind: RealtimeKind;
  label: string;
  /** Last state the session reported: created, open, closed, or what the browser says (connected, activated…). */
  state: string;
  started: number;
  last: number;
  sent: number;
  received: number;
  errors: number;
  events: RealtimeEvent[];
}

const STATE_OF: Record<string, string> = { create: 'created', open: 'open', close: 'closed' };

/** One session per id, in the order they began. Only events without a `part` move the session state. */
export function groupSessions(events: readonly RealtimeEvent[]): RealtimeSession[] {
  const sessions = new Map<string, RealtimeSession>();
  for (const event of events) {
    let session = sessions.get(event.id);
    if (!session) {
      session = {
        id: event.id,
        kind: event.kind,
        label: event.id,
        state: '',
        started: event.time,
        last: event.time,
        sent: 0,
        received: 0,
        errors: 0,
        events: [],
      };
      sessions.set(event.id, session);
    }
    session.events.push(event);
    session.last = event.time;
    if (event.type === 'create' && event.label) session.label = event.label;
    if (event.type === 'message') {
      if (event.dir === 'send') session.sent++;
      else session.received++;
    } else if (event.type === 'error') session.errors++;
    if (!event.part) session.state = STATE_OF[event.type] ?? (event.type === 'state' ? (event.detail ?? session.state) : session.state);
  }
  return [...sessions.values()];
}

/** Filter values that name a kind differently from the kind itself. */
export const REALTIME_KIND_ALIASES: Record<string, string> = {
  rtc: 'webrtc',
  bc: 'broadcast',
  broadcastchannel: 'broadcast',
  workers: 'worker',
  sw: 'service-worker',
  serviceworker: 'service-worker',
  wt: 'webtransport',
  ws: 'websocket',
  websockets: 'websocket',
  eventsource: 'sse',
};

const eventText = (event: RealtimeEvent) => `${event.type} ${event.part ?? ''} ${event.detail ?? ''} ${event.data ?? ''}`.toLowerCase();

/**
 * Compiles a query such as `kind:webrtc,broadcast state:open -is:error ping`. `kind:` and `state:`
 * take comma lists, `is:error` keeps sessions that reported an error, and other words must appear
 * in the session's name, kind or in any of its events (their detail and payload). Unknown keys fall
 * back to free text, as in the request filter.
 */
export function realtimeMatcher(query: string): (session: RealtimeSession) => boolean {
  const tests: ((session: RealtimeSession) => boolean)[] = [];
  for (const raw of query.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    const negated = raw.length > 1 && raw.startsWith('-');
    const term = negated ? raw.slice(1) : raw;
    const colon = term.indexOf(':');
    const key = colon > 0 ? term.slice(0, colon) : '';
    const value = term.slice(colon + 1);
    let test: (session: RealtimeSession) => boolean;
    if (key === 'kind') {
      const kinds = value.split(',').map((kind) => REALTIME_KIND_ALIASES[kind] ?? kind);
      test = (session) => kinds.includes(session.kind);
    } else if (key === 'state') {
      const states = value.split(',');
      test = (session) => states.includes(session.state.toLowerCase());
    } else if (key === 'is' && value === 'error') {
      test = (session) => session.errors > 0;
    } else {
      test = (session) =>
        `${session.kind} ${session.label} ${session.state}`.toLowerCase().includes(term) ||
        session.events.some((event) => eventText(event).includes(term));
    }
    tests.push(negated ? (session) => !test(session) : test);
  }
  return (session) => tests.every((test) => test(session));
}
