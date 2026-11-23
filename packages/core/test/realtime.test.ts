/* oxlint-disable typescript/no-explicit-any, unicorn/require-post-message-target-origin -- the page globals the hook patches are faked here, and a fake channel has no origin */
import { describe, expect, it } from 'vitest';
import {
  groupSessions,
  parseRealtimeDrain,
  realtimeDrainExpression,
  realtimeHook,
  realtimeMatcher,
  realtimeSendExpression,
  type RealtimeEvent,
} from '../src/index.ts';

// ------------------------------------------------------------------------- fake page globals

class FakeChannel extends EventTarget {
  ordered = true;
  protocol = '';
  negotiated = false;
  sent: unknown[] = [];
  label: string;
  constructor(label: string) {
    super();
    this.label = label;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
}

class FakePeer extends EventTarget {
  connectionState = 'new';
  localDescription: unknown = null;
  config?: unknown;
  constructor(config?: unknown) {
    super();
    this.config = config;
  }
  createDataChannel(label: string) {
    return new FakeChannel(label);
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' });
  }
  setLocalDescription(description: unknown) {
    this.localDescription = description;
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.reject(new Error('bad sdp'));
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  close() {}
}

class FakeWorker extends EventTarget {
  posted: unknown[] = [];
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  terminate() {}
}

const bytes = (...values: number[]) => new Uint8Array(values);
const streamOf = (chunk: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });

class FakeWebTransport {
  ready = Promise.resolve();
  closed = new Promise(() => {});
  draining = new Promise(() => {});
  written: unknown[] = [];
  datagrams = { readable: streamOf(bytes(9)), writable: new WritableStream() };
  incomingBidirectionalStreams = new ReadableStream({
    start: (controller) => {
      controller.enqueue({
        readable: streamOf(bytes(7)),
        writable: new WritableStream({ write: (chunk) => void this.written.push(chunk) }),
      });
      controller.close();
    },
  });
  incomingUnidirectionalStreams = new ReadableStream({ start: (controller) => controller.close() });
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  async createBidirectionalStream() {
    return { readable: streamOf(bytes(1, 2, 3)), writable: new WritableStream({ write: (chunk) => void this.written.push(chunk) }) };
  }
  async createUnidirectionalStream() {
    return new WritableStream({ write: (chunk) => void this.written.push(chunk) });
  }
  close() {}
}

class FakeSocket extends EventTarget {
  protocol = 'chat.v1';
  readyState = 1;
  sent: unknown[] = [];
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {}
}

class FakeEventSource extends EventTarget {
  readyState = 1;
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  close() {}
}

function fakeServiceWorkers() {
  const worker = Object.assign(new EventTarget(), { state: 'installing', scriptURL: 'https://example.test/sw.js', postMessage() {} });
  const registration = Object.assign(new EventTarget(), {
    scope: 'https://example.test/',
    installing: worker,
    waiting: null,
    active: null,
    update: () => Promise.resolve(),
    unregister: () => Promise.resolve(true),
  });
  const container = Object.assign(new EventTarget(), {
    controller: null,
    register: (url: string) => (url === 'bad.js' ? Promise.reject(new Error('script not found')) : Promise.resolve(registration)),
    getRegistrations: () => Promise.resolve([]),
  });
  return { container, registration, worker };
}

function pageScope() {
  const sw = fakeServiceWorkers();
  const scope: any = {
    BroadcastChannel: globalThis.BroadcastChannel,
    Worker: FakeWorker,
    SharedWorker: undefined,
    RTCPeerConnection: FakePeer,
    WebTransport: FakeWebTransport,
    WebSocket: FakeSocket,
    EventSource: FakeEventSource,
    navigator: { serviceWorker: sw.container },
    location: { href: 'https://example.test/app/' },
  };
  realtimeHook(scope);
  return { scope, sw };
}

const drain = (scope: any, epoch = '', after = 0) => parseRealtimeDrain(scope.__betterDevToolsRealtime.drain(epoch, after))!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------------------------- the hook

describe('realtime hook', () => {
  it('logs BroadcastChannel traffic in both directions and leaves the channel working', async () => {
    const { scope } = pageScope();
    const a = new scope.BroadcastChannel('chat');
    const b = new scope.BroadcastChannel('chat');
    expect(a).toBeInstanceOf(globalThis.BroadcastChannel);
    const received = new Promise<MessageEvent>((resolve) => b.addEventListener('message', (event: MessageEvent) => resolve(event)));
    a.postMessage({ hi: 1 });
    expect((await received).data).toEqual({ hi: 1 });
    a.close();
    b.close();

    const events = drain(scope).events;
    const [first, second] = groupSessions(events);
    expect(first).toMatchObject({ kind: 'broadcast', label: 'chat', sent: 1, state: 'closed' });
    expect(second).toMatchObject({ received: 1, state: 'closed' });
    expect(events.find((e) => e.dir === 'send')?.data).toBe('{"hi":1}');
  });

  it('logs a Worker by its resolved URL, its messages and its errors', () => {
    const { scope } = pageScope();
    const worker = new scope.Worker('job.js', { type: 'module' });
    worker.postMessage('go');
    worker.dispatchEvent(new MessageEvent('message', { data: { done: true } }));
    expect(worker.posted).toEqual(['go']);

    const [session] = groupSessions(drain(scope).events);
    expect(session).toMatchObject({ kind: 'worker', label: 'https://example.test/app/job.js', sent: 1, received: 1 });
    expect(session!.events[0]?.data).toContain('module');
  });

  it('logs WebRTC signalling and data channels without touching the page promises', async () => {
    const { scope } = pageScope();
    const pc = new scope.RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.test:3478'], username: 'user', credential: 'SECRET' }] });
    const channel = pc.createDataChannel('chat');
    channel.send('hello');
    expect(channel.sent).toEqual(['hello']);
    await pc.createOffer();
    await pc.setLocalDescription({ type: 'offer', sdp: 'v=0' });
    await expect(pc.setRemoteDescription({ type: 'answer', sdp: 'x' })).rejects.toThrow('bad sdp');
    pc.connectionState = 'connected';
    pc.dispatchEvent(new Event('connectionstatechange'));
    channel.dispatchEvent(new MessageEvent('message', { data: 'hi back' }));
    await tick();

    const events = drain(scope).events;
    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(JSON.stringify(events)).not.toContain('"user"');
    const [session] = groupSessions(events);
    expect(session).toMatchObject({
      kind: 'webrtc',
      label: 'RTCPeerConnection · stun:stun.test:3478',
      state: 'connected',
      errors: 1,
      sent: 1,
      received: 1,
    });
    expect(events.filter((e) => e.type === 'sdp').map((e) => e.detail)).toEqual(['createOffer · offer', 'setLocalDescription · offer']);
    expect(events.find((e) => e.part === 'channel "chat"' && e.dir === 'send')?.data).toBe('hello');
    expect(events.find((e) => e.type === 'error')?.detail).toContain('bad sdp');
  });

  it('logs WebTransport streams and datagrams while the page still reads and writes them', async () => {
    const { scope } = pageScope();
    const transport = new scope.WebTransport('https://example.test:4433/wt');
    const stream = await transport.createBidirectionalStream();
    const read = await stream.readable.getReader().read();
    expect([...read.value]).toEqual([1, 2, 3]);
    const writer = stream.writable.getWriter();
    await writer.write(bytes(4, 5));
    const uni = await transport.createUnidirectionalStream();
    await uni.getWriter().write(bytes(6));
    const incoming = (await transport.incomingBidirectionalStreams.getReader().read()).value;
    expect([...(await incoming.readable.getReader().read()).value]).toEqual([7]);
    expect([...(await transport.datagrams.readable.getReader().read()).value]).toEqual([9]);
    await tick();

    expect(transport.written).toEqual([bytes(4, 5), bytes(6)]);
    const events = drain(scope).events;
    const [session] = groupSessions(events);
    expect(session).toMatchObject({ kind: 'webtransport', label: 'https://example.test:4433/wt', state: 'open', sent: 2, received: 3 });
    expect(events.filter((e) => e.type === 'stream').map((e) => e.part)).toEqual([
      'bidirectional #1',
      'unidirectional #2',
      'bidirectional #3',
    ]);
    expect(events.find((e) => e.part === 'bidirectional #1' && e.dir === 'receive')).toMatchObject({ binary: true, size: 3 });
  });

  it('follows a Service Worker from register() through its states', async () => {
    const { scope, sw } = pageScope();
    const registration = await scope.navigator.serviceWorker.register('/sw.js');
    expect(registration).toBe(sw.registration);
    await tick();
    sw.worker.state = 'activated';
    sw.worker.dispatchEvent(new Event('statechange'));
    await expect(scope.navigator.serviceWorker.register('bad.js')).rejects.toThrow('script not found');
    await tick();

    const [session, failed] = groupSessions(drain(scope).events);
    expect(session).toMatchObject({ kind: 'service-worker', label: 'https://example.test/sw.js', state: 'activated' });
    expect(session!.events.map((e) => e.detail)).toEqual([undefined, 'installing', 'register()', 'activated']);
    expect(failed).toMatchObject({ label: 'bad.js', errors: 1 });
  });

  it('hands events over once: acknowledged ones go, a new page starts over', () => {
    const { scope } = pageScope();
    new scope.BroadcastChannel('x').close();
    const first = drain(scope);
    expect(first.events.length).toBe(2);
    const last = first.events.at(-1)!.seq;
    expect(drain(scope, first.epoch, last).events).toEqual([]);
    new scope.BroadcastChannel('y').close();
    // a cursor from another page means nothing here: everything still buffered is sent
    expect(drain(scope, 'another page', 999).events).toHaveLength(2);
    // acknowledged with the right epoch, it is gone
    expect(drain(scope, first.epoch, drain(scope, first.epoch, last).events.at(-1)!.seq).events).toEqual([]);
  });

  it('installs once and survives a page without the APIs', () => {
    const { scope } = pageScope();
    const before = scope.BroadcastChannel;
    realtimeHook(scope);
    expect(scope.BroadcastChannel).toBe(before);
    expect(() => realtimeHook({})).not.toThrow();
    expect(() => realtimeHook({ navigator: {} })).not.toThrow();
  });

  it('logs WebSocket traffic and its close', () => {
    const { scope } = pageScope();
    const socket = new scope.WebSocket('wss://example.test/live', ['chat.v1', 'chat.v2']);
    socket.dispatchEvent(new Event('open'));
    socket.send('{"type":"hello"}');
    socket.dispatchEvent(new MessageEvent('message', { data: '{"type":"welcome"}' }));
    socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([1, 2, 3]).buffer }));
    socket.dispatchEvent(Object.assign(new Event('close'), { code: 1001, reason: 'going away', wasClean: true }));
    expect(socket.sent).toEqual(['{"type":"hello"}']);

    const events = drain(scope).events;
    const [session] = groupSessions(events);
    expect(session).toMatchObject({ kind: 'websocket', label: 'wss://example.test/live', state: 'closed', sent: 1, received: 2 });
    expect(events[0]?.data).toBe('chat.v1, chat.v2');
    expect(events.find((e) => e.type === 'open')?.detail).toBe('subprotocol chat.v1');
    expect(events.find((e) => e.type === 'close')).toMatchObject({ detail: '1001 going away', data: 'clean' });
    expect(events.find((e) => e.binary)).toMatchObject({ data: 'AQID', size: 3 });
  });

  it('logs EventSource messages, including event types the page subscribes to later', () => {
    const { scope } = pageScope();
    const source = new scope.EventSource('https://example.test/stream');
    source.addEventListener('tick', () => undefined);
    source.dispatchEvent(new Event('open'));
    source.dispatchEvent(Object.assign(new Event('message'), { data: 'plain', lastEventId: '' }));
    source.dispatchEvent(Object.assign(new Event('tick'), { data: '{"n":1}', lastEventId: '7' }));
    source.readyState = 0;
    source.dispatchEvent(new Event('error'));
    source.readyState = 2;
    source.dispatchEvent(new Event('error'));

    const events = drain(scope).events;
    expect(groupSessions(events)[0]).toMatchObject({ kind: 'sse', received: 2, errors: 1, state: 'closed' });
    expect(events.filter((e) => e.type === 'message').map((e) => [e.detail, e.data])).toEqual([
      ['message', 'plain'],
      ['tick · id 7', '{"n":1}'],
    ]);
  });

  it('sends through the page objects, so the log records it like any other send', () => {
    const { scope } = pageScope();
    const socket = new scope.WebSocket('wss://example.test/live');
    const channel = new scope.BroadcastChannel('manual');
    const worker = new scope.Worker('w.js');
    const pc = new scope.RTCPeerConnection();
    const data = pc.createDataChannel('chat');
    const [ws, bc, wk, rtc] = groupSessions(drain(scope).events).map((s) => s.id);
    const send = scope.__betterDevToolsRealtime.send;

    expect(send(ws, '', 'hi', false)).toEqual({ ok: true });
    expect(send(ws, '', '{"a":1}', false)).toEqual({ ok: true });
    expect(send(wk, '', '{"job":2}', true)).toEqual({ ok: true });
    expect(send(rtc, 'channel "chat"', 'over rtc', false)).toEqual({ ok: true });
    expect(send(bc, '', '[1,2]', true)).toEqual({ ok: true });
    expect(socket.sent).toEqual(['hi', '{"a":1}']);
    expect(worker.posted).toEqual([{ job: 2 }]);
    expect(data.sent).toEqual(['over rtc']);
    expect(
      drain(scope)
        .events.filter((e) => e.dir === 'send')
        .map((e) => e.data),
    ).toEqual(['hi', '{"a":1}', '{"job":2}', 'over rtc', '[1,2]']);

    expect(send(ws, '', '{bad', true)).toMatchObject({ ok: false });
    expect(send('missing', '', 'x', false)).toMatchObject({ ok: false, error: expect.stringContaining('gone') });
    expect(send(rtc, 'channel "nope"', 'x', false)).toMatchObject({ ok: false });
    channel.close();
    expect(realtimeSendExpression('a', 'b"c', 'te\nxt', true)).toBe(
      'globalThis.__betterDevToolsRealtime ? globalThis.__betterDevToolsRealtime.send("a", "b\\"c", "te\\nxt", true) : null',
    );
  });

  it('is self-contained: its source runs as is in the page', () => {
    const scope: any = { BroadcastChannel: globalThis.BroadcastChannel };
    new Function('scope', `(${realtimeHook.toString()})(scope)`)(scope);
    new scope.BroadcastChannel('serialised').close();
    expect(drain(scope).events[0]).toMatchObject({ kind: 'broadcast', type: 'create', label: 'serialised' });
    expect(realtimeDrainExpression('abc', 4.9)).toContain('.drain("abc", 4)');
  });
});

// -------------------------------------------------------------------------------- the model

const event = (over: Partial<RealtimeEvent>): RealtimeEvent => ({
  seq: 1,
  id: 'a:1',
  kind: 'broadcast',
  time: 1000,
  type: 'message',
  ...over,
});

describe('parseRealtimeDrain', () => {
  it('keeps well-formed events and counts the rest', () => {
    const reply = parseRealtimeDrain({
      epoch: 'e1',
      events: [event({}), { seq: 'x' }, event({ kind: 'telepathy' as never }), event({ data: 'a'.repeat(40_000) }), null],
    });
    expect(reply).toMatchObject({ epoch: 'e1', skipped: 4 });
    expect(reply?.events).toHaveLength(1);
  });

  it('treats anything but a drain reply as "no hook"', () => {
    for (const raw of [null, undefined, 'x', {}, { epoch: 1, events: [] }, { epoch: 'e', events: 'no' }])
      expect(parseRealtimeDrain(raw)).toBeNull();
  });
});

describe('groupSessions', () => {
  it('derives the state from the events that have no part', () => {
    const [session] = groupSessions([
      event({ type: 'create', label: 'peer' }),
      event({ type: 'open' }),
      event({ type: 'state', part: 'ice', detail: 'checking' }),
      event({ type: 'state', detail: 'connected' }),
      event({ type: 'message', dir: 'send' }),
      event({ type: 'message', dir: 'receive' }),
      event({ type: 'error' }),
    ]);
    expect(session).toMatchObject({ label: 'peer', state: 'connected', sent: 1, received: 1, errors: 1 });
    expect(session?.events).toHaveLength(7);
  });

  it('separates sessions by id and keeps them in the order they began', () => {
    const sessions = groupSessions([event({ id: 'b' }), event({ id: 'a' }), event({ id: 'b' })]);
    expect(sessions.map((s) => [s.id, s.events.length])).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
  });
});

describe('realtimeMatcher', () => {
  const sessions = groupSessions([
    event({ id: '1', kind: 'webrtc', type: 'create', label: 'RTCPeerConnection' }),
    event({ id: '1', kind: 'webrtc', type: 'state', detail: 'connected' }),
    event({ id: '2', kind: 'broadcast', type: 'create', label: 'chat' }),
    event({ id: '2', kind: 'broadcast', type: 'message', dir: 'send', data: '{"token":"abc"}' }),
    event({ id: '3', kind: 'worker', type: 'create', label: 'job.js' }),
    event({ id: '3', kind: 'worker', type: 'error', detail: 'boom' }),
  ]);
  const ids = (query: string) => sessions.filter(realtimeMatcher(query)).map((s) => s.id);

  it('filters by kind (with aliases), state and errors', () => {
    expect(ids('kind:webrtc')).toEqual(['1']);
    expect(ids('kind:rtc,bc')).toEqual(['1', '2']);
    expect(ids('state:connected')).toEqual(['1']);
    expect(ids('is:error')).toEqual(['3']);
    expect(ids('-is:error')).toEqual(['1', '2']);
  });

  it('searches names and payloads', () => {
    expect(ids('chat')).toEqual(['2']);
    expect(ids('token')).toEqual(['2']);
    expect(ids('kind:broadcast token')).toEqual(['2']);
    expect(ids('')).toEqual(['1', '2', '3']);
  });
});
