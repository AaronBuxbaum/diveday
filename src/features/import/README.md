# import

This module owns the import use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

## Reviewed existing CSV contracts

The contacts wizard imports past booking visits and unverified source payment history. Its tenant-scoped match preview labels new, existing, and same-file duplicate visits; the writer rechecks identity and deduplicates history at commit. Future-dated bookings remain warnings, not operational seats. This importer never creates or moves a seat, transfers payment, or imports boarding evidence.

Gear service and dive-site restore use local positional header mapping, a first-60-row preview, server-side live match checks, and actual writer totals. Every column must have a unique supported destination: remove an unwanted column from the source file rather than silently dropping it. Both preview and commit reauthorize and remap/reparse the raw files. Preview is advisory; changes made between review and import can change actual outcomes.

A site restore accepts one sites file and optionally one creatures file in either upload order. Their source IDs only link the two files; existing tenant, photo ownership, station confirmation, deleted-site, and field-guide safeguards remain authoritative. Mapping changes names only, never units or values. Gear repeats preserve the existing service evidence and retain historical rental assignments as history, not reservations. Correction downloads include source row numbers and diagnostics and neutralize spreadsheet formulas; remove the diagnostic columns before importing a corrected source file.
