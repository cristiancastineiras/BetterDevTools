# Phase 2 plan: detail, viewers, auth, cookies, controls

Built on the v1 monorepo; capture, replay, collections, export, IndexedDB and virtualization keep
their behaviour. Section numbers follow the prompt.

## Current UI → component map

| area                  | v1                                               | phase 2                                                                                                                  |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| list                  | `RequestList` (virtual grid, text method/status) | + `MethodBadge`, `StatusBadge`, pointer cursor                                                                           |
| detail header         | text buttons, `✕`                                | `MethodBadge` + `StatusBadge` + URL; `IconButton`, `CopyButton`, overflow menu (`ContextMenu`)                           |
| headers tab           | three `dl.kv` lists                              | `HeaderTable` ×3 (General, Response, Request) + `AuthPanel` (Authentication)                                             |
| payload/response      | `BodyView` (pretty/raw/hex/preview)              | `CodeViewer` (Pretty/Raw/Preview, Hex only as an explicit binary action, highlighting, line numbers) + `SourceMapStatus` |
| cookies tab           | two `dl.kv` lists                                | `CookieTable` ×2, cookie export, "Edit for replay", browser cookie jar (`CookieEditor`)                                  |
| replay                | env `<select>`, header `dl`                      | `SelectMenu`, `HeaderTable`, `MethodBadge` in history/result, cookies tab (`CookieEditor`)                               |
| collections           | workspace/env `<select>`, `⋯` text buttons       | `SelectMenu`, `IconButton`                                                                                               |
| save / export dialogs | `<select>`                                       | `SelectMenu`                                                                                                             |
| settings              | theme radios                                     | `SegmentedControl`                                                                                                       |
| toolbar               | `●`, `?`, `⋯` text glyphs                        | `Icon`/`IconButton` (Lucide SVG)                                                                                         |

New shared components in `apps/extension/src/components/ui/`: `Icon`, `IconButton`, `CopyButton`
(also the copy-feedback pattern), `SelectMenu`, `SegmentedControl`, `MethodBadge`, `StatusBadge`,
`HeaderTable` (also serves as the key/value table for query, form and claims, so no separate
`KeyValueTable`), `AuthPanel`, `JwtClaimList`, `CookieTable`, `CookieEditor`, `CodeViewer`,
`SourceMapStatus`. `BodyView.svelte` is removed (replaced by `CodeViewer`).

## Logic moved to `packages/core` (pure, unit-tested first)

- `http.ts`: method and status → semantic token.
- `auth.ts`: auth header detection and scheme classification (Bearer, Basic, JWT, Digest, API key,
  custom, unknown); local JWT decoding (Base64URL, claims, exp/nbf state); never throws.
- `cookies.ts`: `Cookie` / `Set-Cookie` parsing (all attributes), secret counting, JSON/CSV/Netscape
  export with redaction.
- `code.ts`: format detection (MIME + signature + URL), available view modes, tokenizer-based
  highlighting and formatting for JS/TS/JSX/CSS, JSON statistics.
- `sourcemap.ts`: reference detection (comment, headers, inline data URL), v3 parsing, VLQ mapping
  decoding, original position lookup, source URL resolution (`sourceRoot`, relative paths).

UI-only logic with unit tests in `apps/extension/src/lib/`: `listbox.ts` (SelectMenu keyboard model)
and `copy.ts` (CopyButton state).

## Cross-browser risks

- `cookies` and `declarativeNetRequest` are not available in Firefox DevTools panels (the `permissions`
  API is not there either). Firefox shows why browser-cookie editing and custom replay cookies are
  unavailable. Viewing and exporting cookies works everywhere.
- `fetch` cannot set `Cookie`. Edited replay cookies are attached with a one-request
  `declarativeNetRequest` session rule (optional permission, asked at send time, removed right after).
- Popover light-dismiss and `<dialog>` are Baseline. Anchor positioning is not available in Firefox,
  so SelectMenu positions itself from script.
- External source maps load only on an explicit "Load source map" click, through the same
  per-origin permission as replay, capped at 10 MB, and aborted when the request changes.

## Dependencies

- `@lucide/svelte` 1.72.0: Svelte 5-native, `sideEffects: false`, one module per icon (about 25 icons used).
- No highlighting, formatting, source-map or cookie library. `js-beautify` was evaluated and rejected
  (CLI dependencies, about 1 MB unpacked); the own tokenizer covers formatting and highlighting.

## Tests first

Unit: method/status mapping and contrast of every method/status pair (light + dark), auth detection,
JWT (valid Bearer, malformed header/payload, unpadded base64url, expired, not yet valid, single and
multiple audience, missing claims, no JWT), cookie parsing and export redaction, source maps (inline,
external, invalid, no `sourcesContent`, `sourceRoot`, relative paths), format/mode selection (hex
never default), listbox keyboard model, copy state machine.
E2E (Chromium + Edge smoke + Firefox install): copy URL/cURL/headers (success and failure), custom
selects by keyboard, no visible `<select>`, filter, replay header edit, workspace/environment switch,
cookie export, editing a test cookie copy without touching the browser jar, JWT view, JSON/JS formatted
view, no hex by default, axe on panel/replay/dialogs, 50k gate unchanged.
Component checks run in the real extension through Playwright (no jsdom layer added).
