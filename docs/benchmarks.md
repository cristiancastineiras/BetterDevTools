# Benchmarks

Measured on 2026-11-18 on an Intel Core i5-1335U laptop (12 threads, 32 GB), Windows 11, Node
22.18, Chromium 158 (Playwright 1.65). Fixtures are deterministic
(`packages/core/test/fixtures.ts`, `packages/core/test/fixtures/sample.har`). Nothing below is
extrapolated; numbers vary a little between runs.

Reproduce:

```sh
pnpm build:chrome && pnpm bench    # TOON vs JSON, core timings, bundle sizes
pnpm test:e2e                      # prints [bench:e2e] for the 50,000-request panel gate
```

## Phase 0 baseline (template before the rewrite)

pnpm install 14.8 s · build 6.6 s (bundle step 1.0 s) · output 31.3 kB (one popup).

## v1 build

Clean `pnpm install --frozen-lockfile` 20.9 s · `pnpm build` (Chrome + Edge + Firefox + web-ext lint) 17.8 s.

| Chrome build file                                         |     raw |        gzip |
| --------------------------------------------------------- | ------: | ----------: |
| panel.html                                                |  0.6 kB |      0.3 kB |
| chunks/panel (entry)                                      | 52.1 kB |     18.8 kB |
| chunks/app.svelte (store, core, valibot, Svelte runtime)  | 87.5 kB |     31.8 kB |
| chunks/browser                                            |  0.7 kB |      0.4 kB |
| assets/panel.css                                          | 19.5 kB |      5.0 kB |
| **panel initial load**                                    |         | **56.4 kB** |
| chunks/Replay (loaded when the view opens)                |  9.8 kB |      4.0 kB |
| chunks/Collections (loaded when the view opens)           | 10.3 kB |      4.0 kB |
| devtools page (html + js)                                 |  0.3 kB |      0.3 kB |
| fonts: Inter + JetBrains Mono, Latin subsets, self-hosted | 88.7 kB |     (woff2) |

## Solid 2 UI (current)

The UI was rewritten in Solid 2 with i18n (English + Spanish) and TanStack virtual-core. Every view
now loads with the panel (no lazy chunks), which removes the loading step when switching views.

| Chrome build file             |    raw |         gzip |
| ----------------------------- | -----: | -----------: |
| panel.html                    | 0.5 kB |       0.3 kB |
| chunks/panel (whole UI, core) | 350 kB |     113.2 kB |
| chunks/browser                | 0.7 kB |       0.4 kB |
| assets/panel.css              |  30 kB |       7.0 kB |
| **panel initial load**        |        | **121.0 kB** |

50,000-request gate, five runs of this version: navigation complete 458–567 ms · import 2.0–3.0 s ·
filter computation 4.4–10.8 ms · End key 33–70 ms · worst scroll frame 26–62 ms (was 54–93 ms) ·
JS heap 77–82 MB (was 105–108 MB). The table below is the Svelte v1 measurement, kept for comparison.

## 50,000-request gate (real panel, Chromium, E2E)

| metric                                                       |      result |                 budget |
| ------------------------------------------------------------ | ----------: | ---------------------: |
| panel navigation complete (`performance` navigation entry)   |      293 ms |                  < 1 s |
| import 50,000-entry HAR (parse, validate, render first rows) |       2.2 s |               none set |
| filter computation (`status:404 method:get`, 12,500 matches) | 4.8–10.2 ms |               < 100 ms |
| keystroke to updated count (includes 120 ms debounce)        |  216–245 ms |               none set |
| End key → last row selected and shown                        |    34–55 ms |               < 100 ms |
| worst frame while scrolling 60 frames through the list       |    54–93 ms |        < 200 ms (gate) |
| JS heap with 50,000 entries                                  |  105–108 MB | bounded by ring buffer |

The range covers the runs made on this machine during development.

## Core (Node, 50,000 synthetic entries, median of 5)

| operation                                  |              time |
| ------------------------------------------ | ----------------: |
| ingest (summarize + ring buffer)           |            243 ms |
| filter `method:get status:4xx`             |            4.5 ms |
| filter `items/4999` (free text)            |            5.8 ms |
| filter `size:>2k -domain:api3`             |            4.4 ms |
| filter `body:"ok":false` (searches bodies) |           16.3 ms |
| export HAR, bodies, redacted               |   327 ms, 45.7 MB |
| export JSON                                |   374 ms, 45.7 MB |
| export NDJSON                              |   460 ms, 45.7 MB |
| export CSV (metadata)                      |    221 ms, 7.4 MB |
| export TOON (`agent/1`)                    | 1,312 ms, 25.4 MB |

The panel adds a yield to the event loop every 250 entries during export, so the UI stays responsive.
Sizes are in UTF-16 code units, i.e. characters.

## TOON vs compact JSON (o200k_base tokenizer)

Each row compares the **same records** serialized with `JSON.stringify` and with `encodeToon`.

| records                   | fixture                         | JSON bytes | TOON bytes | Δ bytes | JSON tokens | TOON tokens | Δ tokens |
| ------------------------- | ------------------------------- | ---------: | ---------: | ------: | ----------: | ----------: | -------: |
| agent/1 (the TOON export) | sample.har, 6 entries, complete |      3,498 |      2,948 | −15.7 % |       1,090 |       1,008 |   −7.5 % |
| agent/1                   | 1,000 synthetic, summary only   |    290,439 |    154,261 | −46.9 % |      89,708 |      59,718 |  −33.4 % |
| agent/1                   | 1,000 synthetic, complete       |    634,874 |    523,200 | −17.6 % |     191,384 |     172,396 |   −9.9 % |
| HAR-shaped                | sample.har, 6 entries, complete |      5,371 |      6,277 | +16.9 % |       1,649 |       1,944 |  +17.9 % |
| HAR-shaped                | 1,000 synthetic, summary only   |    519,044 |    610,769 | +17.7 % |     153,485 |     186,352 |  +21.4 % |
| HAR-shaped                | 1,000 synthetic, complete       |    951,732 |  1,104,962 | +16.1 % |     289,168 |     335,202 |  +15.9 % |

Conclusion: TOON saves space only for uniform tables; deep HAR records come out larger. The TOON
export therefore uses the tabular `agent/1` profile (ADR-009). Other tokenizers will give other
numbers; none has been measured.
