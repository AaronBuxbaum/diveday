# H-50: A per-diver record export (issue #726 — loadDiverExportBundleInput, src/db/export.ts) ships with waiver_records.csv's medical_answers column…

- **Status:** Ready
- **Human owner:** Product owner + Tier 2/3 counsel (H-01/H-03's engagement)

## Decision or approval needed

A per-diver record export (issue #726 — `loadDiverExportBundleInput`, `src/db/export.ts`) ships with `waiver_records.csv`'s `medical_answers` column withheld. The incident export withholds medical answers because its reader is an investigator, a boundary H-03 already drew; a subject-access request's reader is the person who wrote the answers, so that argument reverses and the question is not resolved by analogy. Whether a diver asking a shop what it holds about them should receive their own recorded answers to the shop's medical questionnaire.

## Minimum outcome to record

A yes or a no, and if yes, whether it ships as part of `waiver_records.csv` or as a separate file a diver must take an extra step to include (the incident-export pattern for anything sensitive).

## Unblocks / follow-up

No code is blocked on this — the export ships now with every other field of the diver's own signed evidence (status, signature, timestamps, template text) and the column absent, stated in the bundle's own README. Once answered, restoring the column is a one-line change to the `waiver_records.csv` entry in `src/db/export-diver-files.ts`.

Part of the [human decision log](README.md#decision-register).
