# <img src="icon.svg" alt="BetterDevTools logo" width="32" height="32"> BetterDevTools

A DevTools panel for Chrome, Edge and Firefox (Manifest V3) to inspect, replay, compare and export
HTTP traffic. Everything stays on your machine: no permissions at install, no telemetry.

## Features

- **Capture**: live requests with response bodies (read at capture time, so they survive navigation),
  requests recorded before the panel opened, pause/resume, clear, keep-across-navigation, HAR import.
  A virtualized list holds 50,000+ requests with resizable columns and mouse/keyboard multi-selection;
  drag the separator (or use the arrow keys on it) to resize the list and the details.
- **Filter**: `method:get,post status:4xx domain:api mime:json type:fetch size:>10k duration:>500ms
  priority:high initiator:script source:import is:error is:redirect body:token`, free text, `-` to exclude.
  Optionally, free text also searches inside response bodies.
- **Inspect**: headers as collapsible sections (expand/collapse all), query, payload, response,
  cookies and timing. Pretty JSON (big numbers kept exact), a collapsible JSON tree, XML/HTML, GraphQL,
  forms, raw/base64, hex dump, sandboxed HTML and image previews. Find in a body highlights every
  match and steps through them (Enter / Shift+Enter, match case).
  Truncated, empty, unavailable and discarded bodies are labelled as such. Copy URL, cURL, headers or bodies.
- **Replay**: pick the method from a list, edit URL, query, headers and body; `{{variables}}` from
  environments. Sent from the inspected page by default (same origin and CORS as the original), or
  from the extension. Credentials off by default; confirmation before any non-GET/HEAD/OPTIONS request;
  diff against the captured response; local history.
- **Collections**: workspaces, nested collections and folders, environments with secret variables,
  duplicate, move and reorder, import/export with validation. Stored in IndexedDB.
- **Export**: selection, filter results or everything as HAR 1.2, JSON, NDJSON, CSV or TOON v1. You
  choose request/response detail, bodies, timings and truncation; redaction is on by default; you get
  a preview, an estimated size and warnings for incomplete bodies. The output is streamed.
- Command palette (Ctrl+K), context menus, keyboard shortcuts, light/dark/system theme, English and
  Spanish (follows the browser, or choose in Settings).

## Use

```sh
corepack enable
pnpm install
pnpm build              # .output/chrome-mv3, edge-mv3, firefox-mv3 in apps/extension
```

- **Chrome / Edge:** `chrome://extensions` → Developer mode → _Load unpacked_ →
  `apps/extension/.output/chrome-mv3` (or `edge-mv3`). Open DevTools → **BetterDevTools** tab.
- **Firefox (142+):** `about:debugging` → _Load Temporary Add-on_ →
  `apps/extension/.output/firefox-mv3/manifest.json`. Open the browser's Network panel once,
  then the BetterDevTools tab.

Shortcuts: Ctrl+K commands · Ctrl+E pause/resume · Ctrl+L clear · Ctrl+F or `/` filter ·
Ctrl+O import · Ctrl+Shift+E export · Alt+1/2/3 views · arrows, Shift, Ctrl+A, Space in the list ·
Shift+F10 actions menu · R replay · Esc close details · Ctrl+Enter send.

## Develop

| command                                                        | what                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                    | oxlint (no warnings allowed) + oxfmt check                                                                       |
| `pnpm typecheck`                                               | tsc for core, tests and the app                                                                                  |
| `pnpm test`                                                    | Vitest unit tests                                                                                                |
| `pnpm build` / `build:chrome` / `build:edge` / `build:firefox` | production builds (Firefox build is followed by `web-ext lint`)                                                  |
| `pnpm test:e2e`                                                | Playwright: panel suites (Chromium), real-DevTools capture (Chromium + Edge if installed), Firefox install smoke |
| `pnpm bench`                                                   | reproducible numbers for [docs/benchmarks.md](docs/benchmarks.md) (run `build:chrome` first)                     |
| `pnpm --filter extension dev`                                  | WXT dev mode with reload                                                                                         |

Before `pnpm test:e2e` the first time: `pnpm --filter extension exec playwright install chromium`.

## Docs

- [Architecture, capability matrix, data model, budgets, risks](docs/architecture.md)
- [Decisions (ADRs)](docs/decisions.md)
- [Security, permissions and privacy](docs/security.md)
- [TOON v1 format](docs/toon.md)
- [Benchmarks](docs/benchmarks.md)

## License

No license has been chosen yet.
