# FAQ

## What is BetterDevTools?

A DevTools panel for Chrome, Edge and Firefox (Manifest V3). It captures the HTTP traffic of the inspected page, lets
you inspect large responses, edit and replay requests, map an application's API automatically (API AutoDiscovery),
keep collections, and export traffic in several formats. See the [README](README.md).

## Does it send my data anywhere?

No. There is no telemetry and no remote service. Captured traffic lives in memory while DevTools is open. Workspaces,
environments, replay history and saved discovery sessions are stored in the extension's IndexedDB in your browser. Replay
requests go to the URL you chose, and nowhere else. Details in [docs/security.md](docs/security.md).

## Which permissions does it need?

None at install. Site access for a specific origin, `cookies` and `declarativeNetRequestWithHostAccess` are optional and
requested only when you start an action that needs them (sending a replay from the extension, editing browser cookies,
sending edited cookies or a custom user agent, or switching on "No cache").

## Why does the panel say it is not attached to DevTools?

Capturing uses the browser's DevTools network API, so the panel must be opened from the browser's DevTools. Outside
DevTools (for example the panel page opened directly) you can still import HAR files and analyze them.

## Why do I see no requests in Firefox?

Firefox only reports requests after its own Network panel has been opened once. Open it, then go back to the
BetterDevTools tab.

## Why does a request say its body is unavailable, truncated or discarded?

Browsers do not always give an extension a response body (streams, blobs, some large responses). A body above the size
limit is cut, and when the memory budget for bodies is exceeded the oldest bodies are dropped. Each case is labelled, and
the limits can be changed in Settings → Capture.

## Which export formats are supported?

Traffic: HAR 1.2, JSON, NDJSON, CSV and TOON v1, with redaction on by default. Collections: the BetterDevTools workspace
format, Postman v2.1, OpenAPI 3.0, and HTTPie and cURL scripts. AutoDiscovery: OpenAPI 3.1 (YAML or JSON), JSON Schemas,
TypeScript interfaces, Markdown, an HTML report and the dependency graph.

## How does API AutoDiscovery decide that `/users/123` and `/users/456` are the same endpoint?

By evidence, not by resemblance. A path segment becomes a parameter when it looks like a value (a number, UUID, ObjectId,
date, a long generated id), or when at least five different values at the same position return the same response shape.
Words such as `/users/me` stay literal. The heuristic can be wrong on unusual routes, so review the result.

## Is an inferred schema a contract?

No. It describes what was observed. A field missing from the samples is not proven optional, and a field seen only once
may be rare rather than required. Freeze a schema as a contract in the Contracts tab when you are satisfied with it;
after that, new responses are validated against it instead of changing it.

## Are tokens and personal data kept in discovery sessions?

No. Full bodies are not stored, header values are not read into the session, and examples are scrubbed of secrets, JWTs,
tokens, emails, card numbers and personal fields before they are kept. See "API AutoDiscovery" in
[docs/security.md](docs/security.md).

## Is "No cache" the same as the DevTools "Disable cache" checkbox?

No. It asks the browser, through a network rule on the inspected tab, to revalidate with `Cache-Control: no-cache`. The
browser may still reply 304. It needs access to all sites, which is requested when you switch it on, and the rule is
removed when the panel closes.

## Can I use it in the browser stores?

Not yet: releases are zip files you load as an unpacked or temporary extension (see the [README](README.md#install)).
Publishing to the stores is a manual, optional step described in [docs/releasing.md](docs/releasing.md).

## What license is it under?

None has been chosen yet.
