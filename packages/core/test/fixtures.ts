import { readFileSync } from 'node:fs';
import { parseHar, type HarEntry } from '../src/index.ts';

export const sampleHarText = readFileSync(new URL('./fixtures/sample.har', import.meta.url), 'utf8');
export const sampleEntries = (): HarEntry[] => parseHar(sampleHarText).entries;

const METHODS = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'];
const TYPES = ['fetch', 'xhr', 'script', 'image', 'stylesheet', 'document'];

/** Deterministic synthetic entry for large-volume tests and benchmarks. */
export function syntheticEntry(i: number): HarEntry {
  const status = [200, 200, 201, 204, 301, 404, 500][i % 7] ?? 200;
  return {
    startedDateTime: new Date(Date.UTC(2026, 0, 1) + i * 37).toISOString(),
    time: (i * 7919) % 2000,
    request: {
      method: METHODS[i % METHODS.length] ?? 'GET',
      url: `https://api${i % 13}.example.com/v1/items/${i}?page=${i % 50}&q=term${i % 97}`,
      httpVersion: 'HTTP/2',
      cookies: [],
      headers: [
        { name: 'accept', value: 'application/json' },
        { name: 'authorization', value: `Bearer secret-${i}` },
      ],
      queryString: [{ name: 'page', value: String(i % 50) }],
      headersSize: -1,
      bodySize: -1,
      ...(i % 6 === 3 ? { postData: { mimeType: 'application/json', text: `{"id":${i},"name":"item ${i}"}` } } : {}),
    },
    response: {
      status,
      statusText: 'OK',
      httpVersion: 'HTTP/2',
      cookies: [],
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { size: 40 + (i % 5000), mimeType: 'application/json', text: `{"id":${i},"ok":${status < 400},"tags":["a","b"]}` },
      redirectURL: status === 301 ? `https://api.example.com/moved/${i}` : '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 1, wait: (i * 31) % 900, receive: 2 },
    _resourceType: TYPES[i % TYPES.length],
    _priority: i % 3 ? 'High' : 'Low',
    _initiator: { type: i % 2 ? 'script' : 'parser' },
  };
}
