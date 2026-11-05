# H-20261025-per-diver-record-export: A per-diver record export (issue #726 — loadDiverExportBundleInput, src/db/export.ts) ships with waiver_records.csv's medical_answers column…

- **Status:** Implemented
- **Human owner:** Product owner + Tier 2/3 counsel (H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit's engagement)

## Decision or approval needed

A per-diver record export (issue #726 — `loadDiverExportBundleInput`, `src/db/export.ts`) ships with `waiver_records.csv`'s `medical_answers` column withheld. The incident export withholds medical answers because its reader is an investigator, a boundary H-20260724-current-typed-name-explicit already drew; a subject-access request's reader is the person who wrote the answers, so that argument reverses and the question is not resolved by analogy. Whether a diver asking a shop what it holds about them should receive their own recorded answers to the shop's medical questionnaire.

## Decision

Aaron, 2026-11-05: medical answers and the medical alert for the crew on any signed waiver are **not treated specially**. They ship in the per-diver export, the shop-wide export, downloads and dumps, and so does the scanned medical intake form of an imported record. The same call extends the diver export to lost-and-found items, messages sent and replied, and as much else about the person as can safely go. Consider it resolved; one follow-up remains, a conversation with counsel as the product scales, tracked as `human-task` issue #3967.

## Minimum outcome to record

A yes or a no, and if yes, whether it ships as part of `waiver_records.csv` or as a separate file a diver must take an extra step to include (the incident-export pattern for anything sensitive).

## Unblocks / follow-up

Built 2026-11-05: `medical_answers`, `medical_alert` and `import_source_medical_document_url` are `both` columns in `src/db/export-shared-files.ts`, and the scanned form rides in the diver bundle's photos.

Part of the [human decision log](README.md#decision-register).
