# FU-20260815-contacts-csv-cannot-tell-uncertified-from-unasked — Carry "not certified yet" into contacts.csv, the file the shop's next system actually reads

- **Status:** Open
- **Raised:** 2026-08-15 — the `dive-domain-expert` pass on `people.no_certification_declared_at`
  (ADR 20260814-self-declared-cards, amendment 2026-08-15).
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/db/export.ts`, `src/db/export.test.ts`,
  `docs/engineering/backup-and-restore-runbook.md`

## What I noticed

The export bundle carries the new stamp in `people.csv` and nowhere else. But `people.csv` is the
normalized table dump; **`contacts.csv` is the flat, import-ready row a destination system maps** —
one line per person with their cert columns folded in, built exactly so a shop leaving DiveDay (or
arriving from a spreadsheet) has a file that means something without a schema.

In that file a diver who *answered* "I'm not certified yet" is byte-identical to a diver nobody ever
asked: blank card columns, blank agency, blank level. Which is the precise ambiguity this feature was
built to remove — reintroduced for the reader most likely to act on it, since a destination system
importing `contacts.csv` will happily prompt staff to "complete" that record, and a shop reading it in
a spreadsheet will read a gap as an oversight.

## Why it isn't already done

`people.csv` was the obvious home (the stamp is a `people` column) and adding it there was one line.
`contacts.csv` is a wider contract: its header is the shape the contact **importer** understands, so
adding a column there is a decision about the round trip, not just the dump. That deserves its own
look at `src/db/import.ts` rather than a drive-by column, and the export has a coverage test that
guards tables rather than columns, so nothing would have caught a mistake.

## Proposed change

Add one column to `contacts.csv` — `no_certification_declared_at`, beside the certification columns
it belongs with — and decide, in the same change, whether the importer should read it back. Two
honest options:

- **Export only.** The value is the diver's own word and a destination system should not resurrect it
  as anything stronger. One column, no importer change, one sentence in the bundle README note
  (`EXPORT_FILE_NOTES`) saying what it means and that it is not a certification.
- **Round-trip it.** `src/db/import.ts` learns the column and writes the stamp through
  `recordSelfDeclaredCards`'s own rules rather than a direct write, so the anti-displacement guard
  still applies to an imported file.

Recommendation: export only, first. An imported claim is materially more trustworthy than a stranger
typing on a public form (that distinction is the whole reason `imported_at` and `self_declared_at`
are separate columns), and quietly turning a CSV cell into a diver's self-declaration blurs exactly
that line.

**Not** proposed: a "certification: none" value in the level column of either file. That is the
`certifications`-row mistake the ADR refuses, one file format down.

## Prompt

```text
Carry the "not certified yet" answer into contacts.csv, not just people.csv.

`people.no_certification_declared_at` (ADR 20260814-self-declared-cards, amendment 2026-08-15)
travels in the export's people.csv. It does not travel in contacts.csv — the flat, import-ready file
a shop's next system actually maps — so in that file a diver who answered "I'm not certified yet"
looks identical to a diver nobody asked: blank cert columns. That is the exact ambiguity the column
was added to remove.

Read first:
  - docs/product/follow-ups/FU-20260815-contacts-csv-cannot-tell-uncertified-from-unasked.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — decision 2 and the 2026-08-15
    amendment, for why this is never a certification row
  - src/db/export.ts — the contacts.csv builder and EXPORT_FILE_NOTES
  - src/db/import.ts — before deciding whether the column round-trips

The work: one column on contacts.csv beside the certification columns, a sentence in that file's
bundle note saying what it means and that it is not a certification, and a test in
src/db/export.test.ts covering a stamped person and an unasked person in the same bundle.

Constraints that make this non-obvious:
  - Never emit a "none" value in a certification level or agency column. The ADR refuses a
    `certifications` row for this answer for five separate reader-shaped reasons; a CSV cell is the
    same mistake one file format down.
  - Decide deliberately whether src/db/import.ts reads it back. An imported CSV is materially more
    trustworthy than a stranger typing on a public form, which is why `imported_at` and
    `self_declared_at` are separate columns — do not blur that. Export-only is the recommendation;
    if you round-trip it, write through recordSelfDeclaredCards so the anti-displacement guard holds.
  - The export bundle is security-sensitive: read the hard rules in AGENTS.md and get a
    security-reviewer pass if the importer changes.

Done when: pnpm check is green, pnpm test src/db/export.test.ts passes, and
docs/product/follow-ups/FU-20260815-contacts-csv-cannot-tell-uncertified-from-unasked.md is deleted.
```
