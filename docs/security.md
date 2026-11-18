# Security and privacy

## Permissions (Manifest V3)

| key                                       | value                                                   | why                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devtools_page`                           | `devtools.html`                                         | registers the BetterDevTools panel; capture APIs exist only in DevTools contexts                                                                        |
| `permissions`                             | none                                                    | capture through `devtools.network` needs no permission; IndexedDB needs none                                                                            |
| `host_permissions`                        | none                                                    | nothing is granted at install                                                                                                                           |
| `optional_host_permissions`               | `http://*/*`, `https://*/*`                             | asked **for one origin at a time** when you press Send in Replay, so the extension can read that origin's response. Refusing keeps replay to plain CORS |
| `content_security_policy.extension_pages` | `script-src 'self'; object-src 'none'; base-uri 'none'` | no inline or remote scripts, no plugins                                                                                                                 |
| Firefox `data_collection_permissions`     | `required: ["none"]`                                    | the extension collects nothing                                                                                                                          |

E2E builds (`BDT_E2E=1`, output in `.output-e2e`) additionally grant `http://127.0.0.1/*` and carry
a per-run public key so tests know the extension id. Release builds never contain either.

## Data handling

- Captured traffic stays in the panel's memory and disappears when DevTools closes.
- Workspaces, environments, replay history and settings are stored in the extension's IndexedDB on
  this device, **unencrypted**. Secret variables are masked in the UI and left out of workspace
  exports unless you opt in (with a confirmation).
- No analytics, telemetry, crash reporting or remote logging. The only network requests the
  extension makes are the replays you send.
- Local logs (`console`, prefixed `[betterdevtools]`) are structured and pass through
  `redactDeep`, which masks secret-named fields.

## Redaction

On by default for every export and for "Copy as HAR entry": `Authorization`, `Proxy-Authorization`,
`Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-Token`, `X-CSRF-Token`, all cookie values, and
secret-named parameters (`token`, `access_token`, `password`, `secret`, `api_key`, `sig`, …) in URLs
(query **and** fragment), redirect targets, URL-bearing headers (`Location`, `Referer`), urlencoded
bodies and JSON bodies. You can add names. Exporting without redaction requires ticking an explicit
acknowledgement. Header values that look secret are hidden in the inspector until "Show secrets".

## Untrusted input

- HAR, workspace files, DevTools entries and stored records are parsed with valibot schemas.
  Invalid HAR entries are skipped and counted; an invalid workspace file is rejected **before**
  anything is written, so existing data is never touched (E2E-tested).
- Size limits: HAR imports ≤ 512 MB, workspace files ≤ 20 MB, ≤ 5,000 items and ≤ 12 folder levels,
  strings ≤ 1 MB. Deep JSON is rejected before the recursive schema runs.
- Prototype pollution: valibot rebuilds objects from known keys; the TOON decoder defines keys with
  `Object.defineProperty`, so `"__proto__"` stays data (unit-tested).
- XSS: response bodies are rendered as text. HTML previews go into `<iframe sandbox="">` (no scripts,
  opaque origin) with a prepended CSP (`default-src 'none'`), so no remote request or script runs.
  SVG and images are shown through `<img>` only.
- CSV exports prefix cells starting with `= + - @` with `'` (formula injection).
- cURL output single-quotes every argument (shell injection).
- Replay accepts only `http:` and `https:` URLs. Requests other than GET/HEAD/OPTIONS need an explicit
  confirmation; the send path enforces it (`assertReplayAllowed`), and importing or analysing files
  never sends anything (unit- and E2E-tested). Cookies and `Authorization` are omitted unless you
  enable "Include credentials"; credentials are never written to history or collections.
- File downloads use generated names (`betterdevtools-<timestamp>.<ext>`), never names from captured data.

## Known limits

- `web-ext lint` reports one `UNSAFE_VAR_ASSIGNMENT`: Solid's runtime clones its own compile-time
  templates through `innerHTML`. No captured content reaches that path.
- Replay is sent from the inspected page by default (`devtools.inspectedWindow.eval` starts a `fetch`
  there), so it has exactly the page's origin and CORS rights, nothing more; credentials stay `omit`
  unless you include them and confirm. The evaluated code is a fixed function from the extension; the
  request only travels in it as JSON data. Sent from the extension origin instead (your choice, or
  edited cookies), site access is asked per origin and lets the extension read that origin's responses.
