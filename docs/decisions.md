# Decisions (ADRs)

Short records: context, decision, consequence. Sources are named where a principle was taken from;
nothing was copied from them.

## ADR-000 — Phase 0 audit of the existing workspace (2026-11-18)

**Found:** a WXT 0.21.5 + Svelte 5 + Tailwind 4.3 + Vite 8 template with one popup entrypoint, a
package named `trello-azure-devops` and a page titled "Trello ↔ Azure DevOps": leftovers that did
not match this project. No git repository.
**Baseline:** install 14.8 s, build 6.6 s (bundle 1.0 s), output 31.3 kB.
**Decision:** replace the template with the monorepo; read bodies at capture time
(DevTools forgets them on navigation), use Playwright's full Chromium for extension tests, prefer
`execCommand('copy')` inside DevTools panels.

## ADR-001 — Toolchain and versions

pnpm 10.28 via Corepack, exact versions, `minimumReleaseAge: 4320` (no dependency younger than three
days). WXT 0.21.5, Vite 8.3.8 (Rolldown), Svelte 5.57, Tailwind 4.3.5, Vitest 5.1, Playwright 1.65,
oxlint 1.93 and oxfmt 0.78. **TypeScript stays on 6.0.3**: TypeScript 7 (native) is out, but
svelte-check needs the TypeScript language-service API, which 7.0 does not ship.
oxfmt formats TS/JS/JSON/CSS; Svelte markup is checked by svelte-check (`--fail-on-warnings`) because
oxfmt does not format `.svelte` files yet.

## ADR-002 — One domain package instead of ten

The prompt suggested `ui`, `domain`, `capture`, `exporter`, `import-export`, `replay`, `workspace`,
`browser-adapter`, `telemetry` and `test-utils`. Each would have had one consumer, its own
package.json and tsconfig, and no independent release. **Decision:** `packages/core` (pure domain,
split by file) plus `apps/extension` (UI + browser adapter + storage). The dependency direction and
the "core knows no Svelte and no extension APIs" rule are kept and enforced (separate tsconfig,
`import/no-cycle`). No `telemetry` package: there is no telemetry, local or remote. No tsdown or
Changesets: nothing is published or prebuilt.

## ADR-003 — No background worker, no content scripts, no runtime messaging

The panel document can use `devtools.network` and IndexedDB directly. A background worker would
duplicate state and add a messaging layer with nothing to carry. **Consequence:** capture lives as
long as DevTools is open, which is what DevTools APIs allow anyway.

## ADR-004 — Minimal permissions

The manifest requests **no permissions** and no host access at install. Replay asks for one origin at
a time (`optional_host_permissions`) when the user sends. Firefox panels cannot ask (no
`permissions` API there), so replay falls back to plain CORS there; this is documented, not worked
around.

## ADR-005 — Main-thread filtering, no worker, no WASM

50,000 entries filter in 4–16 ms in Node and 5–10 ms in the panel (benchmarks.md). A worker would
need to copy or share the entries and would not beat that. Rust/WASM were not considered further:
no benchmark showed a need.

## ADR-006 — valibot at every trust boundary

Inputs from DevTools, imported files and IndexedDB are untrusted. valibot (tree-shakable) gives one schema per shape and the TypeScript types from it, instead of
hand-written checks plus duplicate interfaces. Imported objects are rebuilt from known keys, so
`__proto__` keys cannot pollute prototypes.

## ADR-007 — Bodies captured eagerly, outside reactive state

DevTools invalidates request handles on navigation, so bodies are read with `getContent()` when the
request finishes, capped per body and in total, and stored in a plain `Map`. The list reads
`log.view` by reference. Oldest bodies are dropped first and reported as **discarded**.

## ADR-008 — Exports stream into Blob parts

Exporters are generators that yield one chunk per entry. The panel batches about 4 MB of strings
into `Blob` parts, so the JS heap never holds the whole file (Blob storage can live outside the heap).
The File System Access API was rejected: it is unavailable in Firefox and blocked in DevTools'
cross-origin iframes.

## ADR-009 — TOON export uses a flat, tabular profile

Measurements (benchmarks.md) showed that HAR-shaped records in TOON are 16–21 % _larger_ than compact
JSON. The TOON export therefore uses `agent/1`: one uniform `requests` table and optional `details`,
which is 16–47 % smaller in bytes and 7.5–33 % in tokens than the same data as JSON. HAR fidelity
stays in the HAR/JSON/NDJSON exports.

## ADR-010 — Accessibility approach

Native `<dialog>` for confirmations (safe action autofocused), `popover` for the context menu,
`role=grid` + `aria-activedescendant` for the virtual list, tab panels per WAI-ARIA APG, theme via
`<meta name="color-scheme">` + `light-dark()` tokens (principles from Chrome's modern-web-guidance:
`dialog`, `menu`, `dark-mode-toggle`, `copy-button`). `focusgroup` is not used yet: it is
Chromium-only, so menus use explicit roles and their own arrow-key handling in every browser.
Contrast of every token pair is unit-tested; axe-core runs in E2E in light, dark and narrow layouts.

## ADR-011 — References that were consulted

- Chrome **modern-web-guidance**: guides listed in ADR-010.
- **W3C / WHATWG specs** that apply: HAR 1.2 (W3C Web Performance WG draft), Fetch (forbidden request
  headers, CORS, credentials modes), CSP Level 3, IndexedDB 3, WAI-ARIA 1.2 + APG, WCAG 2.2 contrast.
- **google/elephant-goldfish-model** (Apache-2.0): its "fresh-context review" practice was applied:
  the code review ran in a separate context without this conversation, and its ten findings were
  fixed with regression tests. Not a dependency.
- **benjitaylor/skills**: its one skill (Stageshow) is about faux product UI and states no verifiable
  UI or accessibility criteria, so nothing applied.

## ADR-012 — Solid 2 UI split into state modules

The UI moved from Svelte 5 to Solid 2. The single `app` state class was replaced by small modules in
`src/state/` (capture, preferences, workspaces, replay, import, ui, shared request actions), each with
descriptive names and one job. Large data stays outside reactivity (`CaptureLog`); signals only mirror
what the screen needs. Solid 2 applies writes on the next flush, so code that must read a value right
after writing it either keeps a plain mirror variable (recording, active request, select index) or
calls `flush()` (preferences, workspaces). Dialogs are driven by one `openDialog` signal and one shared
confirmation (`askConfirmation()`), instead of component handles. Styling is Tailwind utilities plus
shared class lists in `components/ui/styles.ts`; `app.css` only holds tokens and base rules.

## ADR-013 — Libraries for i18n and virtualization

- **@solid-primitives/i18n 3.0** (first release for Solid 2): flattened dictionaries, typed keys and
  `{{ name }}` templates. English defines the keys; Spanish is typed against it and a unit test
  checks key and placeholder parity. Language follows the browser unless set in Settings.
- **@tanstack/virtual-core 3** behind a 60-line Solid binding (`lib/virtual.ts`): the request grid
  (fixed rows, recycled by position) and the code view (measured rows, so wrapped minified lines
  work). This replaced two hand-written windowing loops and made large bodies scroll smoothly
  instead of capping them at 5,000 lines.
- Rejected: a JSON-tree library (none supports Solid 2 yet; the tree is ~200 lines and renders
  children only when opened) and the CSS Custom Highlight API for search (not available in every
  target browser for `::highlight` styling of selection-free text; `<mark>` works everywhere).

## ADR-014 — Replays are sent from the inspected page by default

A replay of an untouched request could fail ("Failed to fetch") although the original worked: from
the extension origin the request is cross-origin, and a DevTools panel cannot always show the
host-permission prompt, so CORS blocked it. Two fixes:

1. **Send from the inspected page** (default when the panel is in DevTools): `inspectedWindow.eval`
   starts the `fetch` in the page and the panel collects the result with a short poll that lasts
   only while that one request is in flight. The request has the page's origin, so the CORS rules
   that let the page call the API apply again. Credentials stay `omit` unless the user opts in and
   confirms. Edited cookies still need the extension (a network rule sets `Cookie`), so that case
   switches to the extension automatically and says so.
2. **Browser-added headers are not copied into the draft** (`User-Agent`, `Priority`,
   `Cache-Control`, `Pragma`, `Accept-Language`, `Upgrade-Insecure-Requests`…). Set from `fetch`
   they count as script-set headers and turn a simple request into a CORS preflight the server
   may reject; the browser adds its own values anyway.

Permission prompts are raced against a 30 s timeout, so a prompt that never appears cannot leave
the panel waiting forever.
