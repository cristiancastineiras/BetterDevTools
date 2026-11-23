import { graphqlOf } from './format.ts';
import type { HarEntry } from './har.ts';

// Tags the network panel can honestly derive from one HAR entry: the wire version, the security
// layer and the application protocol. Everything here comes from the URL scheme, method, headers
// and the request body, so it works on live traffic and on imported HAR files alike.

/** Filter values that name a tag differently from the tag itself (`protocol:h2`, `protocol:websocket`). */
export const PROTOCOL_ALIASES: Record<string, string> = {
  http1: 'http/1.1',
  'http1.1': 'http/1.1',
  h2: 'http/2',
  http2: 'http/2',
  h3: 'http/3',
  http3: 'http/3',
  websocket: 'ws',
  websockets: 'ws',
  wss: 'ws',
  eventsource: 'sse',
  xmlrpc: 'xml-rpc',
  serviceworker: 'service-worker',
};

const WEBDAV_METHODS = new Set(['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'REPORT', 'SEARCH']);
const SOAP_NAMESPACE = /schemas\.xmlsoap\.org\/soap\/envelope|www\.w3\.org\/2003\/05\/soap-envelope/;
const XML_RPC_CALL = /^\s*(?:<\?xml[^>]*\?>\s*)?<methodCall[\s>]/;
const DATA_TYPE = /[/+](json|xml)\b/;
const NOT_AN_API = /svg|xhtml|html|rss|atom/;

type Pairs = HarEntry['request']['headers'];
const headerOf = (headers: Pairs, name: string): string => headers.find((h) => h.name.toLowerCase() === name)?.value.toLowerCase() ?? '';

function versionTag(version: string): string[] {
  if (/h3|http\/3|quic/.test(version)) return ['http/3', 'quic'];
  if (/h2|http\/2/.test(version)) return ['http/2'];
  return version.includes('http/1.1') ? ['http/1.1'] : [];
}

/**
 * Protocols one captured entry used, as lower-case tags (`http/2`, `tls`, `ws`, `graphql`, ...).
 * QUIC is reported because HTTP/3 only runs on it. What a browser never shows a DevTools panel
 * (raw TCP/UDP, plain FTP/SFTP, native MQTT/AMQP, TLS handshakes) cannot be tagged here, except an
 * ftp/sftp URL in an imported file. shortcut: GraphQL batches (JSON arrays) are not recognised.
 */
export function protocolsOf(har: HarEntry): string[] {
  const { request: rq, response: rs } = har;
  const tags = new Set<string>();
  const scheme = URL.parse(rq.url)?.protocol.slice(0, -1) ?? '';
  const resourceType = typeof har._resourceType === 'string' ? har._resourceType.toLowerCase() : '';

  for (const tag of versionTag((rs.httpVersion || rq.httpVersion).toLowerCase())) tags.add(tag);
  if (scheme === 'http' || scheme === 'https') tags.add('http');
  if (scheme === 'https') tags.add('https');
  if (scheme === 'ftp' || scheme === 'ftps' || scheme === 'sftp') tags.add(scheme === 'sftp' ? 'sftp' : 'ftp');
  if (scheme === 'https' || scheme === 'wss' || scheme === 'ftps' || (har.timings.ssl ?? -1) > 0) tags.add('tls');

  const requestType = (headerOf(rq.headers, 'content-type') || rq.postData?.mimeType || '').toLowerCase();
  const responseType = (headerOf(rs.headers, 'content-type') || rs.content.mimeType).toLowerCase();
  const body = rq.postData?.text ?? '';
  const applicationTags = new Set<string>();

  const isWebSocket =
    scheme === 'ws' ||
    scheme === 'wss' ||
    resourceType === 'websocket' ||
    (rs.status === 101 && headerOf(rq.headers, 'upgrade') === 'websocket');
  if (isWebSocket) {
    applicationTags.add('ws');
    // MQTT, AMQP and GraphQL subscriptions travel over WebSocket and announce themselves as its subprotocol
    const subprotocol = headerOf(rs.headers, 'sec-websocket-protocol') || headerOf(rq.headers, 'sec-websocket-protocol');
    if (subprotocol.includes('mqtt')) applicationTags.add('mqtt');
    if (subprotocol.includes('amqp')) applicationTags.add('amqp');
    if (/graphql-(transport-)?ws|subscriptions-transport-ws/.test(subprotocol)) applicationTags.add('graphql');
  }
  if (responseType.includes('text/event-stream') || resourceType === 'eventsource') applicationTags.add('sse');
  if (requestType.includes('application/grpc') || responseType.includes('application/grpc')) applicationTags.add('grpc');
  if (
    headerOf(rq.headers, 'soapaction') ||
    requestType.includes('soap+xml') ||
    responseType.includes('soap+xml') ||
    SOAP_NAMESPACE.test(body)
  )
    applicationTags.add('soap');
  if (XML_RPC_CALL.test(body)) applicationTags.add('xml-rpc');
  if (
    graphqlOf(body) !== null ||
    (rq.method.toUpperCase() === 'GET' && /graphql/i.test(rq.url) && rq.queryString.some((p) => p.name === 'query'))
  )
    applicationTags.add('graphql');
  if (WEBDAV_METHODS.has(rq.method.toUpperCase()) || headerOf(rs.headers, 'dav') || headerOf(rs.headers, 'ms-author-via').includes('dav'))
    applicationTags.add('webdav');
  // best effort: Chrome lists WebTransport sessions as an extended CONNECT, Firefox as a plain request
  if (
    headerOf(rq.headers, ':protocol') === 'webtransport' ||
    headerOf(rq.headers, 'sec-webtransport-http3-draft02') ||
    resourceType === 'webtransport'
  )
    applicationTags.add('webtransport');
  // REST is what is left: a plain HTTP call that exchanges JSON or XML resources
  if (!applicationTags.size && scheme.startsWith('http')) {
    const data = [requestType, responseType].some((type) => DATA_TYPE.test(type) && !NOT_AN_API.test(type));
    if (data) applicationTags.add('rest');
  }

  for (const tag of applicationTags) tags.add(tag);
  if (resourceType === 'xhr' || resourceType === 'fetch') tags.add(resourceType);
  if (har._fetchedViaServiceWorker === true) tags.add('service-worker');
  return [...tags];
}

/** One WebSocket frame as Chrome lists it in the HAR (`_webSocketMessages`). */
export interface WebSocketFrame {
  direction: 'send' | 'receive';
  /** Seconds since the epoch, as Chrome reports it. */
  time: number;
  opcode: number;
  /** Text frames carry text; binary frames (opcode 2) carry base64. */
  data: string;
}

/** The frames an entry carries, skipping anything that is not shaped like one. */
export function webSocketFrames(har: HarEntry): WebSocketFrame[] {
  const raw = har._webSocketMessages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((frame: unknown): WebSocketFrame[] => {
    if (typeof frame !== 'object' || frame === null) return [];
    const { type, time, opcode, data } = frame as Record<string, unknown>;
    if ((type !== 'send' && type !== 'receive') || typeof data !== 'string') return [];
    return [{ direction: type, time: typeof time === 'number' ? time : 0, opcode: typeof opcode === 'number' ? opcode : 1, data }];
  });
}
