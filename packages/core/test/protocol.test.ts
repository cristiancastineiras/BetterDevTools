import { describe, expect, it } from 'vitest';
import { compileFilter, protocolsOf, summarize, webSocketFrames, type HarEntry } from '../src/index.ts';
import { syntheticEntry } from './fixtures.ts';

type Overrides = {
  method?: string;
  url?: string;
  version?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body?: string;
  mime?: string;
  status?: number;
  extra?: Record<string, unknown>;
};

const pairs = (h: Record<string, string> = {}) => Object.entries(h).map(([name, value]) => ({ name, value }));

/** A minimal HAR entry; only what each case sets is present. */
function entry(o: Overrides): HarEntry {
  const base = syntheticEntry(0);
  return {
    ...base,
    ...o.extra,
    request: {
      ...base.request,
      method: o.method ?? 'GET',
      url: o.url ?? 'https://api.example.com/x',
      httpVersion: o.version ?? '',
      headers: pairs(o.requestHeaders),
      queryString: [],
      ...(o.body === undefined ? { postData: undefined } : { postData: { mimeType: 'application/json', text: o.body } }),
    },
    response: {
      ...base.response,
      status: o.status ?? 200,
      httpVersion: o.version ?? '',
      headers: pairs(o.responseHeaders),
      content: { size: 1, mimeType: o.mime ?? '' },
    },
    timings: { ...base.timings, ssl: -1 },
  };
}

const tags = (o: Overrides) => protocolsOf(entry(o));

describe('wire and security layers', () => {
  it('reads the HTTP version the way Chrome and Firefox spell it', () => {
    expect(tags({ version: 'http/1.1' })).toContain('http/1.1');
    expect(tags({ version: 'h2' })).toContain('http/2');
    expect(tags({ version: 'HTTP/2' })).toContain('http/2');
    expect(tags({ version: 'h3' })).toEqual(expect.arrayContaining(['http/3', 'quic']));
    expect(tags({ version: 'http/2+quic/46' })).toContain('quic');
  });

  it('tags the scheme and TLS', () => {
    expect(tags({ url: 'https://a.test/' })).toEqual(expect.arrayContaining(['http', 'https', 'tls']));
    expect(tags({ url: 'http://a.test/' })).not.toContain('tls');
    expect(tags({ url: 'wss://a.test/socket' })).toEqual(expect.arrayContaining(['ws', 'tls']));
    expect(tags({ url: 'ws://a.test/socket' })).not.toContain('tls');
    expect(tags({ url: 'ftp://a.test/f' })).toContain('ftp');
    expect(tags({ url: 'sftp://a.test/f' })).toContain('sftp');
  });
});

describe('application protocols', () => {
  it('GraphQL by body, by GET query and by subscription subprotocol', () => {
    expect(tags({ method: 'POST', body: '{"query":"{ me { id } }"}' })).toContain('graphql');
    expect(tags({ method: 'POST', body: '{"id":1}' })).not.toContain('graphql');
    const get = entry({ url: 'https://a.test/graphql?query=%7Bme%7D' });
    get.request.queryString = [{ name: 'query', value: '{me}' }];
    expect(protocolsOf(get)).toContain('graphql');
    expect(tags({ url: 'wss://a.test/g', requestHeaders: { 'sec-websocket-protocol': 'graphql-transport-ws' } })).toEqual(
      expect.arrayContaining(['ws', 'graphql']),
    );
  });

  it('SOAP by header, content type or envelope namespace', () => {
    expect(tags({ method: 'POST', requestHeaders: { SOAPAction: '"urn:x"' } })).toContain('soap');
    expect(tags({ method: 'POST', requestHeaders: { 'content-type': 'application/soap+xml' } })).toContain('soap');
    expect(tags({ method: 'POST', body: '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"/>' })).toContain('soap');
  });

  it('XML-RPC only for a methodCall document', () => {
    expect(tags({ method: 'POST', body: '<?xml version="1.0"?>\n<methodCall><methodName>a</methodName></methodCall>' })).toContain(
      'xml-rpc',
    );
    expect(tags({ method: 'POST', body: '<methodCalls/>' })).not.toContain('xml-rpc');
  });

  it('gRPC and gRPC-Web by content type', () => {
    expect(tags({ method: 'POST', requestHeaders: { 'content-type': 'application/grpc' } })).toContain('grpc');
    expect(tags({ method: 'POST', responseHeaders: { 'content-type': 'application/grpc-web+proto' } })).toContain('grpc');
  });

  it('WebSocket, with MQTT and AMQP as its subprotocol', () => {
    expect(tags({ url: 'wss://a.test/ws' })).toContain('ws');
    expect(tags({ url: 'https://a.test/ws', status: 101, requestHeaders: { Upgrade: 'websocket' } })).toContain('ws');
    expect(tags({ url: 'wss://b.test/mqtt', responseHeaders: { 'sec-websocket-protocol': 'mqttv3.1' } })).toEqual(
      expect.arrayContaining(['ws', 'mqtt']),
    );
    expect(tags({ url: 'wss://b.test/amqp', requestHeaders: { 'sec-websocket-protocol': 'amqp' } })).toContain('amqp');
  });

  it('SSE by content type', () => {
    expect(tags({ mime: 'text/event-stream' })).toContain('sse');
    expect(tags({ responseHeaders: { 'content-type': 'text/event-stream; charset=utf-8' } })).toContain('sse');
  });

  it('WebDAV by method or DAV header', () => {
    expect(tags({ method: 'PROPFIND' })).toContain('webdav');
    expect(tags({ method: 'MKCOL' })).toContain('webdav');
    expect(tags({ method: 'OPTIONS', responseHeaders: { DAV: '1, 2' } })).toContain('webdav');
    expect(tags({ method: 'GET' })).not.toContain('webdav');
  });

  it('WebTransport by its CONNECT headers', () => {
    expect(tags({ method: 'CONNECT', requestHeaders: { ':protocol': 'webtransport' } })).toContain('webtransport');
  });

  it('REST only when nothing more specific claims a JSON or XML call', () => {
    expect(tags({ mime: 'application/json' })).toContain('rest');
    expect(tags({ mime: 'application/vnd.api+json; charset=utf-8' })).toContain('rest');
    expect(tags({ mime: 'text/xml' })).toContain('rest');
    expect(tags({ mime: 'image/svg+xml' })).not.toContain('rest');
    expect(tags({ mime: 'text/html' })).not.toContain('rest');
    expect(tags({ method: 'POST', mime: 'application/json', body: '{"query":"{a}"}' })).not.toContain('rest');
    expect(tags({ mime: 'application/grpc' })).not.toContain('rest');
  });

  it('XHR, Fetch and Service Worker from what the browser reports', () => {
    expect(tags({ extra: { _resourceType: 'xhr' } })).toContain('xhr');
    expect(tags({ extra: { _resourceType: 'fetch' } })).toContain('fetch');
    expect(tags({ extra: { _fetchedViaServiceWorker: true } })).toContain('service-worker');
    expect(tags({ extra: { _fetchedViaServiceWorker: false } })).not.toContain('service-worker');
  });
});

describe('the protocol: filter', () => {
  const rows = [
    summarize(entry({ method: 'POST', body: '{"query":"{a}"}', version: 'h2' }), 1, 'import'),
    summarize(entry({ url: 'wss://a.test/ws', version: 'http/1.1' }), 2, 'import'),
    summarize(entry({ mime: 'application/json', version: 'h3' }), 3, 'import'),
  ];
  const ids = (query: string) => rows.filter(compileFilter(query)).map((r) => r.id);

  it('matches tags, aliases and comma lists', () => {
    expect(ids('protocol:graphql')).toEqual([1]);
    expect(ids('protocol:h2')).toEqual([1]);
    expect(ids('protocol:websocket')).toEqual([2]);
    expect(ids('protocol:quic')).toEqual([3]);
    expect(ids('protocol:graphql,ws')).toEqual([1, 2]);
    expect(ids('-protocol:tls')).toEqual([]);
  });

  it('also finds tags with free text', () => {
    expect(ids('rest')).toEqual([3]);
  });
});

describe('WebSocket frames', () => {
  it('keeps well-formed frames and drops the rest', () => {
    const har = entry({
      url: 'wss://a.test/ws',
      extra: {
        _webSocketMessages: [
          { type: 'send', time: 1, opcode: 1, data: 'hi' },
          { type: 'receive', time: 2, opcode: 2, data: 'AAE=' },
          { type: 'weird', time: 3, opcode: 1, data: 'x' },
          { type: 'send', data: 5 },
          null,
        ],
      },
    });
    expect(webSocketFrames(har)).toEqual([
      { direction: 'send', time: 1, opcode: 1, data: 'hi' },
      { direction: 'receive', time: 2, opcode: 2, data: 'AAE=' },
    ]);
    expect(webSocketFrames(entry({}))).toEqual([]);
  });
});
