# BDT-TOON v1

A line-oriented encoding of JSON values, used by the **TOON** export. It is BetterDevTools' own
codec (`packages/core/src/toon.ts`), inspired by the public idea of token-oriented notation, with
its own versioned grammar. It is not claimed to be compatible with any other TOON implementation.

## Why it exists, and what it saves

It saves tokens only when the data has **uniform rows**. Measured on reproducible fixtures with the
o200k_base tokenizer (`pnpm bench`, numbers in [benchmarks.md](benchmarks.md)):

| data                                   | TOON vs compact JSON                         |
| -------------------------------------- | -------------------------------------------- |
| `agent/1` export (table + details)     | −16 % to −47 % bytes, −7.5 % to −33 % tokens |
| HAR-shaped records (deep, non-uniform) | **+16 % to +21 %** bytes and tokens          |

That is why the TOON export uses the flat `agent/1` profile below instead of HAR records. Use the
JSON/NDJSON/HAR exports when you need full HAR fidelity.

## Document

```
# bdt-toon/1          ← version header, required on line 1; other versions are rejected
<value>
```

- Indentation is exactly two spaces per level. No tabs, no blank lines.
- Lines end with `\n`. The file is UTF-8.

## Values

| JSON                    | TOON                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `null`, `true`, `false` | same literals                                                                                         |
| number                  | JSON number syntax, finite only (`NaN`/`Infinity` are refused by the encoder); `-0` is written as `0` |
| string                  | **bare** when safe, otherwise a JSON string literal (`"…"` with JSON escapes)                         |
| object                  | one `key: value` line per field, nested objects indented one level                                    |
| array                   | `key[N]…` header, in one of the three forms below                                                     |

A string is written bare only if it is non-empty, has no leading or trailing whitespace, is
well-formed Unicode, contains none of `"` `\` `,`, control characters, U+2028/U+2029, `": "`,
does not end with `:`, does not start with `-` `[` `{` `#`, and does not read as `null`, `true`,
`false` or a number. Everything else is quoted, so `"42"`, `"true"`, `"a: b"` and `""` survive as
strings.

Keys matching `[A-Za-z_][A-Za-z0-9_.-]*` are bare; other keys are JSON string literals.

### Arrays

```
tags[3]: a,b c,""                 ← all primitives: inline, comma-separated

users[2]{id,name,admin}:          ← tabular: every item an object with the same keys,
  1,Ada,true                         in the same order, all values primitive
  2,"Bob, Jr.",false

items[3]:                         ← list: anything else, one "- " item per entry
  - id: x                         ← an object item's first field shares the hyphen line;
    meta:                            its other fields are indented one level deeper
      nested: null
  - plain
  - [2]: 1,2                      ← nested array item

none[0]:                          ← empty array
empty:                            ← empty object (a key with nothing nested)
```

An empty object as a list item is a lone `-`. The root may be an object (fields at level 0), an
array (`[N]…` header) or a single primitive line.

### Defined behaviour for non-JSON input

| input                                            | result                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `undefined` object field                         | omitted (as in JSON)                                                                           |
| `undefined` array item                           | `null`                                                                                         |
| `Date` and other `toJSON()` objects              | the `toJSON()` value (dates become ISO strings)                                                |
| `Uint8Array`, `ArrayBuffer`                      | refused; store binaries as base64 strings next to an `encoding: base64` field (HAR convention) |
| `bigint`, functions, symbols, non-finite numbers | refused with a `TypeError`                                                                     |
| `Map`, `Set`, class instances                    | their own enumerable properties, like `JSON.stringify`                                         |

**Lossless guarantee:** for every JSON value without `-0`, `decodeToon(encodeToon(x))` deep-equals
`x`, keys in the same order. Tested on fixtures, edge cases and 500 seeded random values
(`packages/core/test/toon.test.ts`).

## Decoder and validator

`decodeToon(text)` parses strictly and throws `ToonError` with a line number on: missing or
unknown version header, odd indentation, blank lines, item or column count mismatches, unexpected
indentation, duplicate keys, malformed strings or values that should have been quoted.
`validateToon(text)` returns `{ ok, value | error }` instead of throwing. Keys are defined with
`Object.defineProperty`, so a `"__proto__"` key stays data and cannot pollute prototypes.

## Export profile `agent/1`

The TOON export writes this document (streamed, one chunk per row/item):

```
# bdt-toon/1
format: betterdevtools.export
version: 1
profile: agent/1
exportedAt: "2026-11-18T10:00:00.000Z"
count: 2
requests[2]{id,started,method,url,status,statusText,mime,type,durationMs,sizeBytes,error,redirect,bodyState}:
  1,2026-03-01T10:00:00.000Z,GET,https://api.example.com/users/42?token=[REDACTED],200,OK,application/json,fetch,120.5,75,null,null,available
  2,2026-03-01T10:00:04.000Z,GET,https://blocked.example.net/track,0,null,null,xhr,5,0,net::ERR_BLOCKED_BY_CLIENT,null,empty
details[2]:
  - id: 1
    requestHeaders[2]{name,value}:
      accept,application/json
      authorization,[REDACTED]
    responseBody: "{\"id\":42}"
    timings:
      send: 0.5
      wait: 100
      …
  - id: 2
```

- `requests` always has all 13 columns; missing values are `null`. `bodyState` is one of
  `available`, `truncated`, `empty`, `unavailable`, `discarded`.
- `details` is present when the request or response is exported "complete" or timings are on.
  Each item has `id` plus only the fields that have data: `requestHeaders`, `requestBody`,
  `responseHeaders`, `responseBody`, `responseEncoding` (`base64` for binary), `timings`,
  `truncated: true`.
- Redaction and truncation are applied exactly as in the other formats.
