/* oxlint-disable typescript/no-explicit-any, unicorn/consistent-function-scoping -- this code runs against the page's own objects, which have no types we can rely on, and its helpers must stay inside realtimeHook because the function is serialised into the page */

/** Where the hook keeps its buffer on the page's global. Must match the literal inside `realtimeHook`. */
export const REALTIME_KEY = '__betterDevToolsRealtime';

/**
 * Expression that sends a message through an object the page created (a WebSocket, BroadcastChannel,
 * Worker or data channel). `part` names the data channel; empty for the others. null: no hook on the page.
 */
export const realtimeSendExpression = (id: string, part: string, text: string, asJson: boolean): string =>
  `globalThis.${REALTIME_KEY} ? globalThis.${REALTIME_KEY}.send(${JSON.stringify(id)}, ${JSON.stringify(part)}, ${JSON.stringify(text)}, ${asJson}) : null`;

/** Expression that takes the events newer than `after` from the hook, or null when the page has none installed. */
export const realtimeDrainExpression = (epoch: string, after: number): string =>
  `globalThis.${REALTIME_KEY} ? globalThis.${REALTIME_KEY}.drain(${JSON.stringify(epoch)}, ${Math.max(0, Math.trunc(after))}) : null`;

/**
 * Runs inside the inspected page (serialised with toString, so it must stay self-contained: no
 * imports, no module constants). Wraps WebRTC, BroadcastChannel, Worker/SharedWorker, Service
 * Worker registrations and WebTransport so their traffic lands in a buffer the panel drains.
 *
 * Rules it keeps: it never throws into the page, it calls the original function with the original
 * arguments and returns its result untouched, and it only reads what the page already sees.
 * Only objects created after it runs are observed. shortcut: data piped straight into a
 * WebTransport writable (`pipeTo`) and Worker-internal traffic are not seen; add a worker-side hook when needed.
 */
export function realtimeHook(scope: any): void {
  const KEY = '__betterDevToolsRealtime';
  if (scope[KEY]) return;
  const MAX_BUFFER = 5000;
  const MESSAGE_CHARS = 4096;
  const SDP_CHARS = 16384;
  const BINARY_BYTES = 256;
  const epoch = Math.random().toString(36).slice(2, 8);
  const buffer: any[] = [];
  let seq = 0;
  let counter = 0;

  // any failure inside the hook is swallowed: the page must behave as if it were not there
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  // objects the panel may send a message through; weak, so a session never keeps its socket alive
  const senders = new Map<string, { ref: any; method: string }>();
  const register = (id: string, part: string, target: any, method: string) =>
    attempt(() => senders.set(`${id}\u0000${part}`, { ref: new WeakRef(target), method }));

  Object.defineProperty(scope, KEY, {
    value: {
      epoch,
      drain(knownEpoch: string, after: number) {
        const from = knownEpoch === epoch ? after : 0;
        const keep = buffer.findIndex((event) => event.seq > from);
        buffer.splice(0, keep < 0 ? buffer.length : keep);
        return { epoch, events: buffer.slice() };
      },
      /** Sends through the page's own object, so the page and the log both see it as the page's own message. */
      send(id: string, part: string, text: string, asJson: boolean) {
        const entry = senders.get(`${id}\u0000${part}`);
        const target = entry?.ref.deref();
        if (!entry || !target) return { ok: false, error: 'This object is gone or was created before the hook' };
        try {
          target[entry.method](asJson ? JSON.parse(text) : text);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String((error as any)?.message ?? error) };
        }
      },
    },
  });

  /** A text, binary or structured payload as the panel shows it, cut to a safe size. */
  const describe = (value: any, max = MESSAGE_CHARS): Record<string, unknown> =>
    attempt(() => {
      if (typeof value === 'string') return { data: value.slice(0, max), size: value.length, truncated: value.length > max };
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : null;
      if (bytes) {
        let binary = '';
        for (const byte of bytes.subarray(0, BINARY_BYTES)) binary += String.fromCharCode(byte);
        return { data: btoa(binary), size: bytes.length, binary: true, truncated: bytes.length > BINARY_BYTES };
      }
      if (typeof Blob !== 'undefined' && value instanceof Blob) return { data: '', size: value.size, binary: true };
      const text = JSON.stringify(value) ?? String(value); // shortcut: values JSON cannot hold (Map, cycles) show as their type
      return { data: text.slice(0, max), size: text.length, truncated: text.length > max };
    }) ?? { data: Object.prototype.toString.call(value) };

  /** Opens a session and returns the function that adds events to it. */
  const session = (kind: string, label: string, extra: Record<string, unknown> = {}) => {
    const id = `${epoch}:${++counter}`;
    const log = (type: string, fields: Record<string, unknown> = {}) =>
      attempt(() => {
        buffer.push({ seq: ++seq, id, kind, time: Date.now(), type, ...fields });
        if (buffer.length > MAX_BUFFER) buffer.shift();
      });
    log('create', { label, ...extra });
    return Object.assign(log, { id });
  };

  /** Replaces a global constructor by a Proxy: `instanceof`, statics and subclassing keep working. */
  const watchConstructor = (name: string, onCreate: (instance: any, args: any[]) => void) => {
    const Original = scope[name];
    if (typeof Original !== 'function') return;
    attempt(() => {
      scope[name] = new Proxy(Original, {
        construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          attempt(() => onCreate(instance, args));
          return instance;
        },
      });
    });
  };

  const listen = (target: any, handlers: Record<string, (event: any) => void>) => {
    for (const [type, handler] of Object.entries(handlers)) {
      attempt(() => target.addEventListener(type, (event: any) => attempt(() => handler(event))));
    }
  };

  /** Puts `before`/`after` around one method of one object; the original still runs and still returns. */
  const around = (target: any, method: string, before?: ((args: any[]) => void) | null, after?: (result: any, args: any[]) => void) => {
    const original = target?.[method];
    if (typeof original !== 'function') return;
    attempt(() => {
      target[method] = function (this: unknown, ...args: any[]) {
        if (before) attempt(() => before(args));
        const result = original.apply(this, args);
        if (after) attempt(() => after(result, args));
        return result;
      };
    });
  };

  /** Calls `ok` when a promise resolves, or `bad` (default: an error event) when it rejects. */
  const settled = (promise: any, ok: (value: any) => void, bad: (reason: any) => void) => {
    if (promise && typeof promise.then === 'function')
      promise.then(
        (value: any) => attempt(() => ok(value)),
        (reason: any) => attempt(() => bad(reason)),
      );
  };
  const reason = (error: any) => String(error?.message ?? error);

  // ------------------------------------------------------------------------ BroadcastChannel

  watchConstructor('BroadcastChannel', (channel, args) => {
    const log = session('broadcast', String(args[0]));
    listen(channel, {
      message: (event) => log('message', { dir: 'receive', ...describe(event.data) }),
      messageerror: () => log('error', { detail: 'messageerror' }),
    });
    around(channel, 'postMessage', (a) => log('message', { dir: 'send', ...describe(a[0]) }));
    around(channel, 'close', () => log('close'));
    register(log.id, '', channel, 'postMessage');
  });

  // ----------------------------------------------------------------------------- WebSocket

  watchConstructor('WebSocket', (socket, args) => {
    const protocols = ([] as string[]).concat(args[1] ?? []).join(', ');
    const log = session('websocket', String(args[0]), protocols ? { data: protocols } : {});
    listen(socket, {
      open: () => log('open', socket.protocol ? { detail: `subprotocol ${socket.protocol}` } : {}),
      close: (event) => log('close', { detail: `${event.code} ${event.reason}`.trim(), data: event.wasClean ? 'clean' : 'not clean' }),
      error: () => log('error', { detail: 'error' }),
      message: (event) => log('message', { dir: 'receive', ...describe(event.data) }),
    });
    around(socket, 'send', (a) => log('message', { dir: 'send', ...describe(a[0]) }));
    around(socket, 'close', (a) => log('call', { detail: `close(${a.join(', ')})` }));
    register(log.id, '', socket, 'send');
  });

  // --------------------------------------------------------------------- EventSource (SSE)

  watchConstructor('EventSource', (source, args) => {
    const log = session('sse', String(args[0]), args[1] === undefined ? {} : describe(args[1]));
    const heard = new Set<string>();
    const hear = (type: string) => {
      if (heard.has(type)) return;
      heard.add(type);
      listen(source, {
        [type]: (event) =>
          log('message', {
            dir: 'receive',
            detail: event.lastEventId ? `${type} · id ${event.lastEventId}` : type,
            ...describe(event.data),
          }),
      });
    };
    hear('message');
    listen(source, {
      open: () => log('open'),
      error: () =>
        source.readyState === 2 ? log('close', { detail: 'connection closed' }) : log('error', { detail: 'connection lost, retrying' }),
    });
    // the page names its own event types when it subscribes: listen for each one as it appears
    around(source, 'addEventListener', (a) => {
      if (!['open', 'error', 'message'].includes(String(a[0]))) hear(String(a[0]));
    });
    around(source, 'close', () => log('close'));
  });

  // ----------------------------------------------------------------------- Worker, SharedWorker

  for (const [name, shared] of [
    ['Worker', false],
    ['SharedWorker', true],
  ] as const) {
    watchConstructor(name, (worker, args) => {
      const url = attempt(() => new URL(String(args[0]), scope.location?.href).href) ?? String(args[0]);
      const log = session('worker', `${shared ? 'shared · ' : ''}${url}`, args[1] === undefined ? {} : describe(args[1]));
      const port = shared ? worker.port : worker;
      register(log.id, '', port, 'postMessage');
      listen(worker, {
        error: (event) =>
          log('error', { detail: event.message || 'error', data: event.filename ? `${event.filename}:${event.lineno}` : '' }),
      });
      listen(port, {
        message: (event) => log('message', { dir: 'receive', ...describe(event.data) }),
        messageerror: () => log('error', { detail: 'messageerror' }),
      });
      around(port, 'postMessage', (a) => log('message', { dir: 'send', ...describe(a[0]) }));
      if (!shared) around(worker, 'terminate', () => log('close'));
    });
  }

  // ----------------------------------------------------------------------------------- WebRTC

  watchConstructor('RTCPeerConnection', (pc, args) => {
    const servers: string[] = (args[0]?.iceServers ?? []).flatMap((server: any) => [].concat(server.urls ?? [])); // credentials are never read
    const log = session('webrtc', servers[0] ? `RTCPeerConnection · ${servers[0]}` : 'RTCPeerConnection', { data: servers.join('\n') });
    const channels = new WeakSet();

    const watchChannel = (channel: any, origin: string) => {
      if (!channel || channels.has(channel)) return;
      channels.add(channel);
      const part = `channel "${channel.label}"`;
      log('stream', {
        part,
        detail: `data channel (${origin})`,
        data: JSON.stringify({ ordered: channel.ordered, protocol: channel.protocol, negotiated: channel.negotiated }),
      });
      register(log.id, part, channel, 'send');
      listen(channel, {
        open: () => log('open', { part }),
        close: () => log('close', { part }),
        error: (event) => log('error', { part, detail: reason(event.error) }),
        message: (event) => log('message', { part, dir: 'receive', ...describe(event.data) }),
      });
      around(channel, 'send', (a) => log('message', { part, dir: 'send', ...describe(a[0]) }));
    };

    const sdp = (action: string, dir: string, description: any) =>
      log('sdp', {
        dir,
        detail: `${action}${description?.type ? ` · ${description.type}` : ''}`,
        ...describe(description?.sdp ?? '', SDP_CHARS),
      });

    listen(pc, {
      icecandidate: (event) =>
        log('candidate', { dir: 'send', detail: 'local', data: event.candidate ? event.candidate.candidate : 'end of candidates' }),
      icecandidateerror: (event) => log('error', { detail: `ICE ${event.errorCode} ${event.errorText}`, data: event.url }),
      iceconnectionstatechange: () => log('state', { part: 'ice', detail: pc.iceConnectionState }),
      icegatheringstatechange: () => log('state', { part: 'gathering', detail: pc.iceGatheringState }),
      signalingstatechange: () => log('state', { part: 'signaling', detail: pc.signalingState }),
      connectionstatechange: () => log('state', { detail: pc.connectionState }),
      negotiationneeded: () => log('call', { detail: 'negotiationneeded' }),
      track: (event) => log('stream', { detail: `track · ${event.track?.kind}`, data: event.track?.id }),
      datachannel: (event) => watchChannel(event.channel, 'remote'),
    });
    for (const method of ['createOffer', 'createAnswer'])
      around(pc, method, null, (result) =>
        settled(
          result,
          (description) => sdp(method, 'send', description),
          (e) => log('error', { detail: `${method}: ${reason(e)}` }),
        ),
      );
    around(pc, 'setLocalDescription', null, (result, a) =>
      settled(
        result,
        () => sdp('setLocalDescription', 'send', a[0] ?? pc.localDescription),
        (e) => log('error', { detail: `setLocalDescription: ${reason(e)}` }),
      ),
    );
    around(pc, 'setRemoteDescription', null, (result, a) =>
      settled(
        result,
        () => sdp('setRemoteDescription', 'receive', a[0]),
        (e) => log('error', { detail: `setRemoteDescription: ${reason(e)}` }),
      ),
    );
    around(pc, 'addIceCandidate', null, (result, a) =>
      settled(
        result,
        () => log('candidate', { dir: 'receive', detail: 'remote', data: a[0]?.candidate ?? 'end of candidates' }),
        (e) => log('error', { detail: `addIceCandidate: ${reason(e)}` }),
      ),
    );
    around(pc, 'createDataChannel', null, (channel) => watchChannel(channel, 'local'));
    for (const method of ['addTrack', 'removeTrack', 'addTransceiver', 'restartIce'])
      around(pc, method, (a) => log('call', { detail: method, data: String(a[0]?.kind ?? a[0] ?? '') }));
    around(pc, 'close', () => log('close'));
  });

  // ---------------------------------------------------------------------------- WebTransport

  watchConstructor('WebTransport', (transport, args) => {
    const log = session('webtransport', String(args[0]), args[1] === undefined ? {} : describe(args[1]));
    let streams = 0;

    // reading goes through a TransformStream so backpressure and errors still reach the page
    const tapReadable = (holder: any, part: string) =>
      attempt(() => {
        const tapped = holder.readable.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              log('message', { part, dir: 'receive', ...describe(chunk) });
              controller.enqueue(chunk);
            },
          }),
        );
        Object.defineProperty(holder, 'readable', { value: tapped, configurable: true });
      });
    // writing keeps the native stream (it has sendOrder, getStats): only the writer it hands out is wrapped
    const tapWritable = (writable: any, part: string) =>
      around(writable, 'getWriter', null, (writer) =>
        around(writer, 'write', (a) => log('message', { part, dir: 'send', ...describe(a[0]) })),
      );
    const tapBidirectional = (stream: any, part: string, detail: string) => {
      log('stream', { part, detail });
      tapReadable(stream, part);
      tapWritable(stream.writable, part);
    };
    const tapIncoming = (name: string, bidirectional: boolean) =>
      attempt(() => {
        const incoming = transport[name].pipeThrough(
          new TransformStream({
            transform(stream, controller) {
              const part = `${bidirectional ? 'bidirectional' : 'unidirectional'} #${++streams}`;
              let delivered = stream;
              if (bidirectional) tapBidirectional(stream, part, `${part} opened by the server`);
              else {
                log('stream', { part, detail: `${part} opened by the server` });
                delivered =
                  attempt(() =>
                    stream.pipeThrough(
                      new TransformStream({
                        transform(chunk, c) {
                          log('message', { part, dir: 'receive', ...describe(chunk) });
                          c.enqueue(chunk);
                        },
                      }),
                    ),
                  ) ?? stream;
              }
              controller.enqueue(delivered);
            },
          }),
        );
        Object.defineProperty(transport, name, { value: incoming, configurable: true });
      });

    settled(
      transport.ready,
      () => log('open'),
      (e) => log('error', { detail: `ready: ${reason(e)}` }),
    );
    settled(
      transport.closed,
      (info) => log('close', { data: JSON.stringify(info) }),
      (e) => log('close', { detail: reason(e) }),
    );
    settled(
      transport.draining,
      () => log('state', { detail: 'draining' }),
      () => undefined,
    );
    around(transport, 'createBidirectionalStream', null, (result) =>
      settled(
        result,
        (stream) => tapBidirectional(stream, `bidirectional #${++streams}`, 'bidirectional stream opened'),
        (e) => log('error', { detail: reason(e) }),
      ),
    );
    around(transport, 'createUnidirectionalStream', null, (result) =>
      settled(
        result,
        (stream) => {
          const part = `unidirectional #${++streams}`;
          log('stream', { part, detail: 'unidirectional stream opened' });
          tapWritable(stream, part);
        },
        (e) => log('error', { detail: reason(e) }),
      ),
    );
    around(transport, 'close', (a) => log('close', { detail: 'close()', data: JSON.stringify(a[0] ?? {}) }));
    tapIncoming('incomingBidirectionalStreams', true);
    tapIncoming('incomingUnidirectionalStreams', false);
    attempt(() => {
      tapReadable(transport.datagrams, 'datagrams');
      tapWritable(transport.datagrams.writable, 'datagrams');
    });
  });

  // ------------------------------------------------------------------------------ Service Worker

  const container = scope.navigator?.serviceWorker;
  if (container) {
    const sessions = new Map<string, ReturnType<typeof session>>(); // one per scope
    const registrations = new WeakSet();
    const workers = new WeakSet();
    let pageLog: ReturnType<typeof session> | undefined;
    const page = () => (pageLog ??= session('service-worker', 'navigator.serviceWorker (this page)'));

    const watchWorker = (worker: any, log: ReturnType<typeof session>) => {
      if (!worker || workers.has(worker)) return;
      workers.add(worker);
      const state = () => log('state', { detail: worker.state, data: worker.scriptURL });
      state();
      listen(worker, { statechange: state, error: () => log('error', { detail: 'service worker error', data: worker.scriptURL }) });
      around(worker, 'postMessage', (a) => log('message', { dir: 'send', ...describe(a[0]) }));
    };

    const watchRegistration = (registration: any): ReturnType<typeof session> => {
      const scopeUrl = String(registration.scope);
      let log = sessions.get(scopeUrl);
      if (!log) {
        const script = (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL ?? scopeUrl;
        log = session('service-worker', String(script), { data: JSON.stringify({ scope: scopeUrl }) });
        sessions.set(scopeUrl, log);
      }
      if (!registrations.has(registration)) {
        registrations.add(registration);
        const own = log;
        listen(registration, {
          updatefound: () => {
            own('call', { detail: 'updatefound' });
            watchWorker(registration.installing, own);
          },
        });
        around(registration, 'update', () => own('call', { detail: 'update()' }));
        around(registration, 'unregister', null, (result) =>
          settled(
            result,
            (done) => own('close', { detail: `unregister() · ${done}` }),
            (e) => own('error', { detail: reason(e) }),
          ),
        );
      }
      for (const worker of [registration.installing, registration.waiting, registration.active]) watchWorker(worker, log);
      return log;
    };

    around(container, 'register', null, (result, a) =>
      settled(
        result,
        (registration) =>
          watchRegistration(registration)('call', {
            detail: 'register()',
            data: JSON.stringify({ script: String(a[0]), options: a[1] ?? {} }),
          }),
        (e) => session('service-worker', String(a[0]))('error', { detail: `register(): ${reason(e)}` }),
      ),
    );
    listen(container, {
      controllerchange: () => page()('state', { detail: 'controllerchange', data: container.controller?.scriptURL ?? '' }),
      message: (event) => page()('message', { dir: 'receive', ...describe(event.data) }),
      messageerror: () => page()('error', { detail: 'messageerror' }),
    });
    attempt(() =>
      settled(
        container.getRegistrations(),
        (list) => list.forEach(watchRegistration),
        () => undefined,
      ),
    );
  }
}
