# 20261102-papaparse-csv-reader — Use Papa Parse as the shared CSV reader

- **Status:** Accepted
- **Date:** 2026-11-02
- **Supersedes:** the "no new runtime dependency" reader in [20260723-contact-importer](20260723-contact-importer.md)

## Context

`parseCsv` in `src/lib/import.ts` was a hand-written state machine, and it now reads every import
family: contacts, dive sites and their creatures, gear, and the assist mapping sample. It runs in
the browser preview and again on the server, so both must read a file the same way. Issue #3239
compared Papa Parse 5.7.0 and csv-parse 7.0.3: on a 20,000 × 64 synthetic grid Papa took ~24 ms /
42 MiB against ~44 ms / 67 MiB for the old reader and ~252 ms / 227 MiB for csv-parse; isolated
browser bundles were ~7.3 KB gzip for Papa and ~14.3 KB for csv-parse. Aaron chose to adopt a
library on 2026-11-02.

## Decision

`papaparse` 5.7.0 (exact pin; `@types/papaparse` 5.5.2 as a dev dependency) becomes the reader
inside `parseCsv`, called with a fixed comma delimiter, `"` quote and escape, no header, no type
coercion and no worker. Kept outside the library, in our code:

- the UTF-8 BOM strip, and CRLF and lone CR rewritten to LF before parsing (Papa reads one line
  ending per file, and a file saved by two tools mixes them);
- dropping the empty row after a final line break;
- the 8 MiB byte check, now before parsing in every caller, and the row, column and cell bounds;
- blank-row filtering, the formula unguard (which now also accepts `'` before LF, since a guarded
  leading CR reads as LF), and every tenant and safety rule.

Malformed quoting is read leniently and never refused, so the preview shows exactly what the
server imports. `src/lib/import.test.ts` pins the policy, including where it differs from the old
reader: a quote inside an unquoted cell is literal (`Bob "Bobby" Smith`), text after a closing
quote keeps the quote and reads on to the next quote that closes a cell, a doubled quote after an
unclosed quote stays doubled, and a quoted CRLF becomes LF. An unclosed quote still takes the rest
of the file, as before.

Provenance: npm `papaparse`, MIT, maintained by Matt Holt (`mholt`) and Sergi Almacellas
(`pokoli`), source github.com/mholt/PapaParse; no dependencies.

## Alternatives considered

- **Keep the state machine** — small, but every format edge case is ours alone.
- **csv-parse** — twice the bundle and about ten times the time and memory on the same grid.
- **Refuse a file Papa reports errors for** — clearer for a broken file, but a new refusal with its
  own copy; worth doing only if shops send malformed files.

## Consequences

One maintained reader serves all four importers, and a quote in the middle of a name now survives.
The import page's client bundle grows by Papa's ~7 KB gzip. A Papa upgrade can change malformed
input reading; the pinned tests catch it. To leave, restore a reader behind the same `parseCsv`
signature; no caller sees the library.
