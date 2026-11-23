import type { Captured } from './har.ts';

// Page load analysis: Core Web Vitals scored with Google's thresholds, findings from what the
// network recorded plus what the page reports about itself, and the rows of a waterfall.

export type Rating = 'good' | 'needs-improvement' | 'poor';

/** [good up to, poor from] for each metric, in the metric's own unit. */
export const THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
} as const;
export type MetricName = keyof typeof THRESHOLDS;

export function rate(metric: MetricName, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-improvement';
}

/** What the page's observers report (see perf-page.ts); every metric may still be missing. */
export interface PageMetrics {
  lcp?: { value: number; element: string; url: string } | undefined;
  cls?: number | undefined;
  inp?: { value: number; target: string } | undefined;
  fcp?: number | undefined;
  ttfb?: number | undefined;
  domContentLoaded?: number | undefined;
  load?: number | undefined;
  longTasks: { count: number; blocking: number };
  /** Resources the browser says delay the first paint (Chrome's renderBlockingStatus). */
  blocking: string[];
  images: { src: string; natural: [number, number]; rendered: [number, number]; bytes: number }[];
}

export type PerfFindingCode =
  | 'render-blocking'
  | 'oversized-image'
  | 'uncompressed'
  | 'slow-request'
  | 'no-cache'
  | 'no-store-static'
  | 'huge-response'
  | 'redirect'
  | 'http1-crowding'
  | 'long-tasks'
  | 'layout-shift';

export interface PerfFinding {
  code: PerfFindingCode;
  severity: 'high' | 'medium' | 'low';
  /** URL, host or element the finding is about. */
  subject: string;
  params: Record<string, string>;
  requests: number[];
}

const STATIC_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media']);
const COMPRESSIBLE = /text\/|json|javascript|xml|svg/i;
export const SLOW_REQUEST_MS = 1000;
export const HUGE_RESPONSE_BYTES = 1_000_000;
const MIN_COMPRESS_BYTES = 1400;
const HTTP1_CROWD = 6;

const header = (c: Captured, name: string) => c.har.response.headers.find((h) => h.name.toLowerCase() === name)?.value.toLowerCase();

export function analyzePerformance(requests: readonly Captured[], page: PageMetrics | undefined): PerfFinding[] {
  const out: PerfFinding[] = [];
  const add = (finding: PerfFinding) => out.push(finding);
  const byUrl = new Map(requests.map((c) => [c.url, c]));

  for (const src of page?.blocking ?? [])
    add({ code: 'render-blocking', severity: 'medium', subject: src, params: {}, requests: byUrl.has(src) ? [byUrl.get(src)!.id] : [] });

  for (const image of page?.images ?? []) {
    const [nw, nh] = image.natural;
    const [rw, rh] = image.rendered;
    if (rw > 0 && rh > 0 && nw * nh > rw * rh * 4 && image.bytes > 50_000) {
      add({
        code: 'oversized-image',
        severity: image.bytes > 300_000 ? 'high' : 'medium',
        subject: image.src,
        params: { natural: `${nw}×${nh}`, rendered: `${rw}×${rh}`, kb: String(Math.round(image.bytes / 1024)) },
        requests: byUrl.has(image.src) ? [byUrl.get(image.src)!.id] : [],
      });
    }
  }
  if (page && page.longTasks.count > 0 && page.longTasks.blocking > 300) {
    add({
      code: 'long-tasks',
      severity: page.longTasks.blocking > 1000 ? 'high' : 'medium',
      subject: '',
      params: { count: String(page.longTasks.count), ms: String(Math.round(page.longTasks.blocking)) },
      requests: [],
    });
  }
  if (page?.cls !== undefined && page.cls > THRESHOLDS.cls[0])
    add({
      code: 'layout-shift',
      severity: page.cls > THRESHOLDS.cls[1] ? 'high' : 'medium',
      subject: '',
      params: { cls: page.cls.toFixed(3) },
      requests: [],
    });

  const perHost = new Map<string, number>();
  for (const c of requests) {
    if (c.har.response.httpVersion.toLowerCase().includes('1.1')) perHost.set(c.host, (perHost.get(c.host) ?? 0) + 1);
    const text = COMPRESSIBLE.test(c.mime);
    if (c.status >= 200 && c.status < 300 && text && c.size > MIN_COMPRESS_BYTES && !header(c, 'content-encoding'))
      add({
        code: 'uncompressed',
        severity: c.size > 100_000 ? 'high' : 'medium',
        subject: c.url,
        params: { kb: String(Math.round(c.size / 1024)) },
        requests: [c.id],
      });
    if (c.duration > SLOW_REQUEST_MS && c.status)
      add({
        code: 'slow-request',
        severity: c.duration > 3000 ? 'high' : 'medium',
        subject: c.url,
        params: { ms: String(Math.round(c.duration)) },
        requests: [c.id],
      });
    if (c.size > HUGE_RESPONSE_BYTES)
      add({ code: 'huge-response', severity: 'medium', subject: c.url, params: { mb: (c.size / 1_048_576).toFixed(1) }, requests: [c.id] });
    if (c.status >= 300 && c.status < 400 && c.redirect)
      add({ code: 'redirect', severity: 'low', subject: c.url, params: { to: c.redirect, status: String(c.status) }, requests: [c.id] });
    if (c.method === 'GET' && c.status === 200 && STATIC_TYPES.has(c.type)) {
      const cache = header(c, 'cache-control') ?? '';
      if (/no-store/.test(cache)) add({ code: 'no-store-static', severity: 'medium', subject: c.url, params: {}, requests: [c.id] });
      else if (
        !/max-age=[1-9]|immutable|s-maxage=[1-9]/.test(cache) &&
        !header(c, 'expires') &&
        !header(c, 'etag') &&
        !header(c, 'last-modified')
      )
        add({ code: 'no-cache', severity: 'medium', subject: c.url, params: {}, requests: [c.id] });
    }
  }
  for (const [host, count] of perHost)
    if (count > HTTP1_CROWD * 3)
      add({ code: 'http1-crowding', severity: 'low', subject: host, params: { count: String(count) }, requests: [] });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.toSorted((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface WaterfallRow {
  id: number;
  url: string;
  label: string;
  status: number;
  type: string;
  /** Milliseconds from the first request's start. */
  start: number;
  /** Consecutive phases that make up the bar, in order, in milliseconds. */
  phases: { name: string; ms: number }[];
  total: number;
}

const PHASES = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'] as const;

/** One row per request in start order, with its timing phases; the panel draws the bars. */
export function waterfall(requests: readonly Captured[], limit = 500): WaterfallRow[] {
  const rows = requests
    .filter((c) => c.started > 0)
    .toSorted((a, b) => a.started - b.started)
    .slice(0, limit);
  const origin = rows[0]?.started ?? 0;
  return rows.map((c) => {
    const timings = c.har.timings as Record<string, unknown>;
    const phases = PHASES.flatMap((name) => {
      const ms = timings[name];
      return typeof ms === 'number' && ms > 0 ? [{ name, ms }] : [];
    });
    const sum = phases.reduce((total, p) => total + p.ms, 0);
    return {
      id: c.id,
      url: c.url,
      label: c.path.length > 80 ? `${c.path.slice(0, 79)}…` : c.path,
      status: c.status,
      type: c.type,
      start: c.started - origin,
      phases: phases.length ? phases : [{ name: 'wait', ms: Math.max(c.duration, 0) }],
      total: Math.max(sum, c.duration, 0),
    };
  });
}
