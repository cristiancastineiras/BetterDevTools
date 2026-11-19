# Changelog

All notable changes to BetterDevTools are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.y.z` the project is in initial
development and any release may change behaviour.

## [Unreleased]

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
