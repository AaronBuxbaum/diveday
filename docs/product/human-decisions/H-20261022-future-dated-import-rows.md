# H-20261022-future-dated-import-rows: What happens to a booking row dated after today in an import?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**The contact importer filed every booking row as visit history, so a shop switching before its season saw seats it had already sold in its old system become past visits, and its boats looked empty.** The 2026-10-22 market sheet (item 3, call 2) offered: leave those rows out of history and list them in the import preview, or keep them as history marked "not sailed yet".

## Decision

**Decided 2026-10-22 (Aaron Buxbaum, in the project thread, the recommended option): a booking row dated after the shop's today is left out of visit history and listed in the import preview.** The diver on the row still imports. Moving those seats onto the board (the sheet's item 9) was declined.

## What shipped

`prepareContactImport` takes the shop's calendar day; a later row gets no visit and is counted and listed under the preview's past-visits notice ("14 bookings are after today. They aren’t seats here. Add them on the board, or keep them in FareHarbor until they sail."), naming the source system when the import was opened from a switching guide. See the amendment to ADR 20260725-import-prior-visits.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
