# BetterDevTools architecture (blueprint)

This is the plan the v1 was built against, updated to what shipped. Decisions and their
reasons are in [decisions.md](decisions.md), measurements in [benchmarks.md](benchmarks.md).

## 1. Packages

```
apps/extension/             WXT app: entrypoints, Solid 2 UI, browser adapter, IndexedDB
  entrypoints/devtools/     devtools page: registers the panel, nothing else
  entrypoints/panel/        the panel document (Solid mount)
  src/lib/devtools.ts       browser adapter: the only code touching devtools.* / permissions.*
  src/lib/db.ts             IndexedDB (stores, versioned upgrades)
  src/lib/virtual.ts        Solid binding for @tanstack/virtual-core (request list, code view)
  src/lib/search.ts         find-in-body: matches and highlighted pieces
  src/i18n/                 English and Spanish dictionaries, t() translator
  src/state/                capture, preferences, workspaces, replay, import, ui, shared actions
  src/components/           views (network, replay, collections), details, dialogs, menu
  src/components/ui/        primitives: buttons, selects, accordion sections, code view, JSON tree
  e2e/                      Playwright: panel suites, real-DevTools smoke, Firefox install smoke
packages/core/              domain, no UI framework and no browser extension APIs
  src/har.ts                HAR 1.2 schema (validation at every boundary), Captured, Body
  src/log.ts                CaptureLog: ring buffer, incremental filtered view, body budget
  src/filter.ts             filter language
  src/format.ts             viewers: JSON re-indent, markup, GraphQL, forms, hex, diff text
  src/diff.ts               line diff
  src/redact.ts             secret redaction (exports, logs)
  src/replay.ts             drafts, variables, confirmation guard, cURL
  src/workspace.ts          workspace schema, migrations, tree editing, import/export
  src/export.ts             HAR / JSON / NDJSON / CSV / TOON streaming exporters
  src/toon.ts               BDT-TOON v1 encoder, decoder, validator
```

Dependencies point one way: `apps/extension → @betterdevtools/core → valibot`. Core is consumed
as TypeScript source (no build step, no tsdown). `import/no-cycle` is enforced by oxlint.

The suggested split into ten packages (ui, domain, capture, exporter, …) was folded into one
domain package because each would have had exactly one consumer; see ADR-002.

## 2. Capability matrix

| capability                           | Chrome / Edge (MV3)                                                                                    | Firefox (MV3, 142+)                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| live capture                         | `devtools.network.onRequestFinished`                                                                   | same API; fires only after the browser's **Network panel has been opened once**                                                                       |
| response body                        | `getContent(cb)` → `(content, encoding)`; base64 for binary                                            | `getContent()` → `[content, mimeType]`; encoding not reported                                                                                         |
| requests before the panel opened     | `getHAR()`; entries keep `getContent`                                                                  | `getHAR()`; bodies may be unavailable                                                                                                                 |
| bodies consumed as stream/blob       | often empty → shown as **unavailable**                                                                 | same                                                                                                                                                  |
| priority / initiator / resource type | `_priority`, `_initiator`, `_resourceType`                                                             | mostly absent → shown as not reported                                                                                                                 |
| WebSocket frames, SSE events         | not exposed by `devtools.network` → not captured                                                       | same                                                                                                                                                  |
| service-worker-served responses      | captured as the page saw them; SW-internal fetches are not                                             | same                                                                                                                                                  |
| TLS / encrypted payloads             | decrypted bodies only, as DevTools exposes them                                                        | same                                                                                                                                                  |
| bodies after a navigation            | kept: read eagerly at capture time                                                                     | same                                                                                                                                                  |
| replay (default: inspected page)     | `inspectedWindow.eval` runs `fetch` in the page: same origin, CORS and network as the original request | same                                                                                                                                                  |
| replay from the extension            | `fetch` from the extension origin; per-origin host permission asked at send (30 s timeout)             | `permissions.request` is not available in DevTools panels: replay works where the server allows CORS, or after granting site access in `about:addons` |
| downloads                            | `<a download>` from a Blob                                                                             | same                                                                                                                                                  |

What the browser does not expose is reported as such (unavailable, discarded, not reported); the
UI never claims complete capture.

## 3. Data model and storage

- **In memory (panel only):** `CaptureLog` holds `Captured[]` (HAR entry without the body + derived
  list/filter fields) and a separate `Map<id, Body>`. Bodies never enter Solid state. The UI mirrors
  `log.view` by reference (a signal with `equals: false`), so updates are O(changed), not deep proxies.
- **Body states:** `available`, `truncated` (per-body cap), `empty`, `unavailable` (browser kept
  none), `discarded` (dropped by the memory budget or ring buffer).
- **IndexedDB `betterdevtools`, version 1:**
  - `workspaces` (key `id`): `{ schemaVersion, id, name, createdAt, updatedAt, activeEnvId, envs[], collections[] }`,
    collections are folder trees of saved requests.
  - `replays` (auto-increment): replay history, newest 200, bodies capped at 256 kB, credentials never stored.
  - `kv`: `prefs`.
- Every stored record is validated on read (valibot); invalid records are skipped and logged, never
  "repaired". Record migrations are reversible steps (`migrate()`, tested with a synthetic v2);
  newer-than-known data is refused.

## 4. Messaging between entrypoints

There is no runtime messaging: no background worker, no content scripts. The devtools page only
calls `devtools.panels.create`; the panel document uses `devtools.network` directly and talks to
IndexedDB itself. The typed contract is the boundary between the panel and DevTools:
everything coming from `onRequestFinished`, `getHAR` and imported files is parsed with
`HarEntrySchema`, and everything read from storage with its schema. Fewer contexts means no
duplicated state between background, panel and storage (ADR-003).

## 5. Build tooling

pnpm 10 workspaces (Corepack `packageManager`, exact versions, `minimumReleaseAge` 3 days) ·
WXT 0.21 (MV3 for Chrome, Edge and Firefox) · Vite 8 with Rolldown · Solid 2, strict
TypeScript 6 · Tailwind CSS 4.3 utilities with CSS tokens (`app.css` holds only tokens and base rules) · oxlint (`--deny-warnings`) and oxfmt · Vitest 5 ·
Playwright 1.65 with axe-core. Details and rejected options: [decisions.md](decisions.md).

## 6. TOON

See [toon.md](toon.md): versioned grammar, encoder, strict decoder/validator, lossless round-trip
tests, and the measured `agent/1` export profile.

## 7. Performance budget

| budget                                           | target             | measured (see benchmarks.md)                                             |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------ |
| panel usable after load                          | < 1 s              | navigation complete in 458–567 ms (E2E)                                  |
| interaction (filter, select, scroll) at 50k rows | < 100 ms           | filter 4.4–10.8 ms; End key 33–70 ms; worst scroll frame 26–62 ms        |
| initial JS+CSS for the panel                     | as small as useful | 121 kB gzip, every view included (loaded from disk, no network)          |
| memory                                           | bounded            | ring buffer (default 10,000, max 100,000) + body budget (default 128 MB) |
| polling                                          | none               | event-driven capture; timers only coalesce bursts                        |

Search runs on the main thread: filtering 50k entries takes single-digit milliseconds, so a worker
would add transfer cost without benefit (ADR-005).

## 8. Risks and browser limits

- DevTools APIs differ between browsers (see §2); Firefox gets an install smoke test only, because
  Playwright cannot load extensions into Firefox.
- Request ordering follows completion (body read) order, not start time.
- Bodies over the per-body cap are truncated; the memory budget drops the oldest bodies first.
- Extension-origin replay is not the page: cookies follow the browser's third-party rules, and
  forbidden headers (Host, Cookie, Origin…) are set by the browser. Replays are therefore sent from
  the inspected page by default; the extension origin is used for edited cookies or when chosen.
- Solid's runtime clones its compile-time templates through `innerHTML`; `web-ext lint` may report
  it as a warning. No remote content is inserted as HTML: previews render in a sandboxed iframe
  with a CSP that blocks scripts and network.
- Workspace data (including secret variables) is stored unencrypted in the browser profile.
