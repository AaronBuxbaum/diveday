# H-23: The owner asked to move rows from the published honesty table's "Stays behind" column…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

The owner asked to move rows from the published honesty table's "Stays behind" column into "Comes across" across every switching surface. Specialty cards (deep, wreck, night, drysuit) were the one row that was a capability gap rather than a boundary we intend to keep — and importing them removes a mitigation [20260724-import-verified-cards](../../architecture/decisions/20260724-import-verified-cards.md) relied on, since "specialties stay gated" was part of why an imported ladder card was allowed to clear the boarding/depth gate. A specialty authorizes a materially riskier dive (deep gates depth past 18 m), so the assistant put three postures to the owner before building: clear the gate on import like a ladder card, land verified but hold the gate until the one-tap staff confirm, or import `pending` and re-verify everything.

## Minimum outcome to record

**Decided 2026-07-25: specialty cards import `verified` and flagged imported, and the specialty gate holds until a staffer taps confirm.** Boarding is never what waits — only the dive that requires the specialty. One card number is never stretched to two cards: a cell naming two specialties imports neither. Payment methods and booking/service history stay behind by design (processor boundary; needs a full-shop importer). Same decision: card expiry now travels with an imported card (including a past date, which lands as expired) and dive insurance comes across as free text.

## Unblocks / follow-up

Implemented: `imported_at`/`imported_from_label` on `specialty_certifications`, the `specialty_import_unconfirmed` readiness blocker, `certification_expires_at` + `dive_insurance` import fields, and the rewritten honesty-table rows. See [20260725-import-specialty-cards](../../architecture/decisions/20260725-import-specialty-cards.md).

Part of the [human decision log](README.md#decision-register).
