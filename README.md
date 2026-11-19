# <img src="icon.svg" alt="BetterDevTools logo" width="32" height="32"> BetterDevTools

**A browser DevTools extension for Chrome, Edge and Firefox that captures HTTP traffic, replays requests, maps an
application's API automatically, and exports everything, with all data kept on your machine.**

[![CI](https://github.com/cristiancastineiras/BetterDevTools/actions/workflows/ci.yml/badge.svg)](https://github.com/cristiancastineiras/BetterDevTools/actions/workflows/ci.yml)

BetterDevTools adds a **BetterDevTools** panel next to the Network tab (Manifest V3). It is aimed at developers who
work with HTTP APIs: inspect large responses without freezing the browser, edit and resend a request the way an API
client does, and turn the traffic of a real application into OpenAPI documents, JSON Schemas and TypeScript types. It
has no telemetry and no remote services, and it asks for no permissions at install time.

## What it does

- **Capture**: live requests with their response bodies (read at capture time, so they survive navigation), requests
  recorded before the panel opened, pause/resume, HAR import. A virtualized list holds 50,000+ requests, with resizable
  columns, multi-selection and a filter language such as `method:post status:5xx domain:api mime:json size:>10k
  body:token`.
- **Inspect**: headers, query, payload, response, cookies and timing. Coloured JSON, XML/HTML, GraphQL and form views, a
  virtualized JSON tree for very large documents (search across the whole document, exact large numbers, "only
  matches", copy value or path), hex and image previews, and find-in-body.
- **Replay**: edit URL, query, headers and body (table with on/off rows, or bulk text), choose a body type (JSON, text,
  JavaScript, HTML, XML, form fields, multipart, GraphQL), use `{{variables}}` from environments, send from the
  inspected page or from the extension, set a custom user agent, and diff the result against the captured response.
  Anything that is not a safe request asks for confirmation first, and credentials are off by default.
- **API AutoDiscovery**: press Start, use your application, press Stop. BetterDevTools builds a map of its API with
  nothing to import or configure: endpoints with normalised path parameters (`/users/123` becomes
  `GET /users/{userId}`), inferred JSON Schemas, contract validation, a dependency graph, scenarios, coverage and
  session comparison. See [API AutoDiscovery](#api-autodiscovery).
- **Collections**: workspaces, folders, environments with secret variables, import/export, and export to Postman v2.1,
  OpenAPI 3.0, HTTPie and cURL scripts.
- **Export**: HAR 1.2, JSON, NDJSON, CSV or TOON v1, with redaction on by default, a preview, a size estimate and a
  "copy only" option.
- **Interface**: light, dark and several named themes, accent colour, interface size, custom fonts, English and Spanish,
  a command palette (Ctrl+K) and keyboard shortcuts.

## Install

### From a release

Download the zip for your browser from the [Releases](https://github.com/cristiancastineiras/BetterDevTools/releases)
page (`SHA256SUMS.txt` is attached to verify it).

- **Chrome / Edge:** unzip `betterdevtools-vX.Y.Z-chrome.zip` (or `-edge`), open `chrome://extensions` or
  `edge://extensions`, turn on Developer mode, choose _Load unpacked_ and pick the folder. Open DevTools and the
  **BetterDevTools** tab.
- **Firefox (142 or later):** `about:debugging` → _This Firefox_ → _Load Temporary Add-on_ → pick the `manifest.json`
  inside the unzipped `betterdevtools-vX.Y.Z-firefox.zip`. Open the browser's Network panel once, then the
  BetterDevTools tab.

These builds are loaded as unpacked or temporary extensions. They are not yet published in the browser stores.

### From source

Requires Node.js 22.18 or later and pnpm (the exact version is pinned in `package.json`, and `corepack` installs it).

```sh
corepack enable
pnpm install
pnpm build:all      # apps/extension/.output/chrome-mv3, edge-mv3 and firefox-mv3
```

Then load `apps/extension/.output/chrome-mv3` (or `edge-mv3`, or `firefox-mv3/manifest.json`) as described above.

## Quick start

1. Open DevTools on any page and choose **BetterDevTools**. Requests appear as the page makes them.
2. Click a request to see its headers, payload, response and timing. In the Response tab, switch between Pretty, Tree
   and Raw, and use the find box (Ctrl+F).
3. Press **Replay** (or `R`) to open it in the editor, change what you need, and send with Ctrl+Enter.
4. Open **Discovery** (Alt+4), press **Start recording**, use your application, then **Stop & analyze**.

Shortcuts: Ctrl+K commands · Ctrl+E pause/resume · Ctrl+L clear · Ctrl+F or `/` filter · Ctrl+O import · Ctrl+Shift+E
export · Alt+1 … Alt+4 views · arrows, Shift, Ctrl+A and Space in the list · Shift+F10 actions menu · R replay · Esc
close details · Ctrl+Enter send.

## API AutoDiscovery

The Discovery view turns what a page does into documentation:

- **Endpoints**: calls are grouped by method and normalised path. A segment becomes a parameter only on evidence (it
  looks like an id, a UUID or a date, or many different values return the same response shape), so look-alike routes
  such as `/users/me` stay apart. GraphQL operations of one URL are separated by operation name.
- **Schemas**: JSON Schemas are inferred from every observed response and request, with optional and nullable fields,
  arrays, nested objects, date and email formats, enum candidates and type conflicts. Schemas are marked as inferred:
  a field missing from the samples is not proven optional.
- **Contracts**: freeze the schemas as a contract and every new response is checked against it, so a changed type or a
  missing required field shows up as a violation.
- **Dependencies**: a data link means a value from one response (a token, an id) appears in a later request; a
  temporal link only means one call followed another.
- **Export**: OpenAPI 3.1 (YAML or JSON), JSON Schemas, TypeScript interfaces, Markdown, an HTML report and the
  dependency graph, or all of them in one zip.

Credentials and personal data are never stored or exported: examples are scrubbed (secret fields, JWTs, tokens, emails,
card numbers, personal fields) before they are kept, and the values that link two requests live in memory only. Details:
[docs/security.md](docs/security.md).

## Limitations

- Capture needs the panel to be opened from the browser's DevTools. Outside DevTools you can still import HAR files and
  analyze them.
- Browsers do not always give an extension a response body (streams, blobs, some large responses). Those requests are
  labelled as incomplete, and inferred schemas only cover the bodies that were available.
- Firefox only reports requests after its Network panel has been opened once.
- The "No cache" switch asks the browser to revalidate (`Cache-Control: no-cache`); the browser may still answer with a 304. It is not the same as the DevTools "Disable cache" checkbox.
- Path parameter detection in AutoDiscovery is a heuristic and can be wrong on unusual routes.
- The Firefox build uses the placeholder add-on id `betterdevtools@local`, and no browser-store listing exists yet.

## Development

| command                                                        | what                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                    | oxlint (no warnings allowed) and oxfmt check                                               |
| `pnpm typecheck`                                               | tsc for the core package, the tests and the app                                            |
| `pnpm test`                                                    | Vitest unit tests                                                                          |
| `pnpm build` / `build:chrome` / `build:edge` / `build:firefox` | production builds (the Firefox build is followed by `web-ext lint`)                        |
| `pnpm zip:all`                                                 | store-ready zips in `apps/extension/.output`                                               |
| `pnpm test:e2e`                                                | Playwright: panel suites, real-DevTools capture (Chromium and Edge), Firefox install smoke |
| `pnpm bench`                                                   | numbers for [docs/benchmarks.md](docs/benchmarks.md) (run `pnpm build:chrome` first)       |
| `pnpm --filter extension dev`                                  | WXT dev mode with reload                                                                   |

The first time you run `pnpm test:e2e`: `pnpm --filter extension exec playwright install chromium`. The code is
organised as `packages/core` (framework-free logic: HAR, filters, redaction, schema inference, exporters) and
`apps/extension` (the Solid UI and the browser adapter). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [FAQ](FAQ.md)
- [Architecture, capability matrix, data model, budgets, risks](docs/architecture.md)
- [Decisions (ADRs)](docs/decisions.md)
- [Security, permissions and privacy](docs/security.md)
- [TOON v1 format](docs/toon.md)
- [Benchmarks](docs/benchmarks.md)
- [How releases are made](docs/releasing.md) and the [changelog](CHANGELOG.md)

## Contributing, security, license

Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities as described in
[SECURITY.md](SECURITY.md). **No license has been chosen yet**, so the code is not yet available for reuse.
