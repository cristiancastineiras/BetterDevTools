# Changelog

All notable changes to BetterDevTools are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.y.z` the project is in initial
development and any release may change behaviour.

## [Unreleased]

### Added

- **Toolbox (Alt+6):** everyday utilities that run locally, with a search box, categories and state that survives
  switching tools. _Data_: JSON/XML/HTML/CSS/JavaScript formatter (JSON also minifies, sorts keys, converts to YAML and
  escapes, and reports the line and column of an error), JSONPath (RFC 9535, with filters and functions). _Encoders_:
  Base64, URL, HTML entities, hex, binary, Unicode escapes, ROT13; JWT decoder with HMAC signature check and token
  comparison. _Generators_: UUID v4/v7 and a UUID reader; MD5, SHA-1/256/384/512, CRC32 and HMAC. _Validators_: regex
  tester (groups, highlighting, replacement; runs in a worker that is stopped when a pattern backtracks too much) and
  webhook signature checks for GitHub, Stripe, Slack and generic HMAC. _Converters_: cURL to fetch, axios, Python, C#
  and Java; number bases, naming styles and text statistics. _Date & time_: epoch and date converter with time zones;
  cron explainer (English and Spanish) with the next runs. _Web_: URL parser; **CORS & security** diagnosis of the
  captured traffic (CORS and preflights, CSP, cookie attributes, security headers, mixed content, certificate errors),
  each finding with why and how to fix it; **Performance** (Core Web Vitals, findings and a waterfall); **Storage**
  (localStorage, sessionStorage, IndexedDB, Cache Storage, Service Workers, cookies, snapshots you can compare, export
  and restore); **HTML & CSS** (selector tester on the page or on pasted HTML, CSS values computed by the page,
  colour conversion, WCAG contrast). _Comparators_: text, JSON (keys sorted) and header-list diff. Any tool that takes
  text can be filled from a captured request.
- **Realtime:** WebSocket and EventSource (SSE) sessions; send a message through a page's WebSocket, BroadcastChannel,
  Worker or data channel; replay the messages the page sent, keeping their timing; compare two messages; export a
  session as a JSON file. The Network detail gets an **Events** tab that parses a `text/event-stream` response.
- **Protocol detection:** every request is tagged with its wire version (HTTP/1.1, HTTP/2, HTTP/3 over QUIC), TLS and
  application protocol (REST, GraphQL, SOAP, gRPC and gRPC-Web, XML-RPC, WebSocket, SSE, WebDAV, WebTransport, MQTT and
  AMQP over WebSocket, XHR, Fetch, Service Worker). Shown in the General section, searchable as free text and with
  `protocol:` (`protocol:graphql,grpc`, `protocol:h2`).
- **WebSocket messages:** a Messages tab lists the frames of a WebSocket (Chrome records them in the HAR).
- **Realtime view (Alt+5):** WebRTC (signalling, SDP, ICE candidates, data channels), BroadcastChannel, Worker and
  SharedWorker, Service Worker lifecycle (register, install, activate, update, unregister, controller changes) and
  WebTransport (sessions, streams, datagrams), listed as sessions with a timeline, a filter (`kind:webrtc is:error
  token`), pause, clear, copy as JSON and a reload that installs the hook before the page's scripts. Needs no new
  permission.

## [0.1.0] - 2026-11-19

First public release: a DevTools panel for Chrome, Edge and Firefox (Manifest V3) to inspect, replay, compare,
document and export HTTP traffic. Everything stays in the browser: no telemetry, no remote services.

### Added

- **Capture:** live requests with their response bodies (read at capture time, so they survive navigation), requests
  recorded before the panel opened, pause/resume, HAR import, a virtualized list that holds 50,000+ requests, and a
  filter language (`method:`, `status:`, `domain:`, `mime:`, `size:`, `duration:`, `body:` …).
- **Inspect:** headers, query, payload, response, cookies and timing; coloured JSON, XML/HTML, GraphQL and form views;
  a virtualized JSON tree for very large documents, with search across the whole document, grouped nodes, exact large
  numbers, "only matches" and copy value/path; hex and image previews; find in body.
- **Replay:** edit URL, query, headers and body as a table with on/off rows or in bulk, pick a body type (JSON, text,
  JavaScript, HTML, XML, form fields, multipart, GraphQL), a coloured URL editor with `{{variable}}` completion,
  environments, a custom user agent, an optional "no cache" mode for the inspected tab, confirmation before anything
  that is not a safe request, and a diff against the captured response.
- **API AutoDiscovery:** records the traffic of an application as you use it and builds a map of its API: endpoints
  with normalised path parameters, inferred JSON Schemas, contract validation (freeze a contract, catch regressions),
  a dependency graph (data and temporal links), scenarios, coverage and session comparison. Exports OpenAPI 3.1
  (YAML/JSON), JSON Schemas, TypeScript interfaces, Markdown, an HTML report and a dependency graph. Credentials and
  personal data are scrubbed before anything is stored or exported.
- **Collections:** workspaces, folders, environments with secret variables, import/export, and export to Postman v2.1,
  OpenAPI 3.0, HTTPie and cURL scripts.
- **Export:** HAR 1.2, JSON, NDJSON, CSV and TOON v1, with redaction on by default, a preview, a size estimate, and a
  "copy only" option.
- **Interface:** light, dark and several named themes, accent colour, interface size, custom fonts, English and
  Spanish, command palette, keyboard shortcuts.

### Notes

- Chrome, Edge and Firefox (142 or later) builds are attached to the release, plus the sources zip Firefox reviewers
  ask for and `SHA256SUMS.txt`.
- No license has been chosen yet, so the code is not yet available for reuse.

[Unreleased]: https://github.com/cristiancastineiras/BetterDevTools/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cristiancastineiras/BetterDevTools/releases/tag/v0.1.0
