// Reproducible measurements for docs/benchmarks.md. Run: pnpm build:chrome && pnpm bench
// Token counts use the o200k_base tokenizer (gpt-tokenizer); no figure here is extrapolated.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import {
  AGENT_COLUMNS,
  agentDetail,
  agentRow,
  CaptureLog,
  DEFAULT_EXPORT,
  encodeToon,
  exportChunks,
  exportRecord,
  FORMATS,
  takeBody,
  type ExportOptions,
} from '../packages/core/src/index.ts';
import { sampleEntries, syntheticEntry } from '../packages/core/test/fixtures.ts';

const root = path.resolve(import.meta.dirname, '..');
const pct = (a: number, b: number) => `${(((b - a) / a) * 100).toFixed(1)}%`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const time = (fn: () => void, runs = 5) =>
  median(
    Array.from({ length: runs }, () => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    }),
  );

function logOf(entries: ReturnType<typeof syntheticEntry>[], capacity = 100_000) {
  const log = new CaptureLog({ capacity, maxBodyChars: 2 << 20, maxTotalBodyChars: 1 << 30 });
  log.add(entries.map((e) => ({ ...takeBody(e), source: 'import' as const })));
  return log;
}

// ---------------------------------------------------------------- TOON vs JSON
console.log('## TOON vs compact JSON (identical data each row, o200k_base tokens)\n');
console.log('| records | fixture | JSON bytes | TOON bytes | bytes Δ | JSON tokens | TOON tokens | tokens Δ |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|');
const sample = logOf(sampleEntries());
const thousand = logOf(Array.from({ length: 1000 }, (_, i) => syntheticEntry(i)));
const records = (log: CaptureLog, partial: Partial<ExportOptions>, agent: boolean) => {
  const o: ExportOptions = { ...DEFAULT_EXPORT, format: 'toon', ...partial };
  const body = (id: number) => log.body(id);
  if (!agent) return { entries: log.entries.map((c) => exportRecord(c, body(c.id), o)) };
  const requests = log.entries.map((c) => Object.fromEntries(agentRow(c, body(c.id), o).map((v, i) => [AGENT_COLUMNS[i], v])));
  return o.request === 'full' || o.response === 'full'
    ? { requests, details: log.entries.map((c) => agentDetail(c, body(c.id), o)) }
    : { requests };
};
const summary: Partial<ExportOptions> = { request: 'summary', response: 'summary', meta: false, timings: false };
const fixtures: [string, string, unknown][] = [
  ['agent/1 (TOON export)', 'sample.har, 6 entries, complete', records(sample, {}, true)],
  ['agent/1 (TOON export)', '1,000 synthetic, summary only', records(thousand, summary, true)],
  ['agent/1 (TOON export)', '1,000 synthetic, complete', records(thousand, {}, true)],
  ['HAR-shaped (JSON export)', 'sample.har, 6 entries, complete', records(sample, {}, false)],
  ['HAR-shaped (JSON export)', '1,000 synthetic, summary only', records(thousand, summary, false)],
  ['HAR-shaped (JSON export)', '1,000 synthetic, complete', records(thousand, {}, false)],
];
for (const [kind, name, entries] of fixtures) {
  const doc = { format: 'betterdevtools.export', version: 1, ...(entries as object) };
  const json = JSON.stringify(doc);
  const toon = encodeToon(doc);
  const [jb, tb] = [Buffer.byteLength(json), Buffer.byteLength(toon)];
  const [jt, tt] = [countTokens(json), countTokens(toon)];
  console.log(`| ${kind} | ${name} | ${jb} | ${tb} | ${pct(jb, tb)} | ${jt} | ${tt} | ${pct(jt, tt)} |`);
}

// ---------------------------------------------------------------- core timings
const big = logOf(Array.from({ length: 50_000 }, (_, i) => syntheticEntry(i)));
console.log('\n## Core timings, 50,000 synthetic entries (median of 5, Node ' + process.version + ')\n');
console.log('| operation | time |');
console.log('|---|---:|');
console.log(
  `| ingest (summarize + ring buffer) | ${time(() => logOf(Array.from({ length: 50_000 }, (_, i) => syntheticEntry(i))), 3).toFixed(0)} ms |`,
);
for (const q of ['method:get status:4xx', 'items/4999', 'size:>2k -domain:api3', 'body:"ok":false']) {
  console.log(`| filter \`${q}\` | ${time(() => big.setQuery(q)).toFixed(1)} ms |`);
}
for (const format of FORMATS) {
  let bytes = 0;
  const ms = time(() => {
    bytes = 0;
    for (const chunk of exportChunks(big.entries, (id) => big.body(id), { ...DEFAULT_EXPORT, format })) bytes += chunk.length;
  }, 3);
  console.log(`| export ${format} (bodies, redacted) | ${ms.toFixed(0)} ms, ${(bytes / 1048576).toFixed(1)} MB |`);
}

// ---------------------------------------------------------------- bundle
const out = path.join(root, 'apps/extension/.output/chrome-mv3');
console.log('\n## Chrome build output (raw / gzip)\n');
console.log('| file | raw | gzip |');
console.log('|---|---:|---:|');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
// initial load = panel.html + the chunks reachable through static imports (dynamic import() is lazy)
const initialFiles = new Set<string>(['panel.html']);
const queue = [...readFileSync(path.join(out, 'panel.html'), 'utf8').matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
while (queue.length) {
  const f = queue.pop()!;
  if (initialFiles.has(f)) continue;
  initialFiles.add(f);
  if (!f.endsWith('.js')) continue;
  const code = readFileSync(path.join(out, f), 'utf8').replace(/import\(\s*["'][^"']+["']\s*\)/g, '');
  for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(path.posix.join(path.posix.dirname(f), m[1]!));
}
let initial = 0;
for (const file of walk(out).filter((f) => /\.(js|css|html)$/.test(f))) {
  const buf = readFileSync(file);
  const gz = gzipSync(buf).length;
  const rel = path.relative(out, file).replaceAll('\\', '/');
  if (initialFiles.has(rel)) initial += gz;
  console.log(`| ${rel}${initialFiles.has(rel) ? '' : ' (lazy)'} | ${kb(buf.length)} | ${kb(gz)} |`);
}
console.log(`| **panel initial load (html+js+css, gzip)** | | **${kb(initial)}** |`);
