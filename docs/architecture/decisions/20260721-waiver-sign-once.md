# 20260721-waiver-sign-once — Satisfy the waiver gate per diver, not per booking

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

A waiver record hangs off a `booking`, and each trip creates a fresh booking, so a returning
diver was asked to re-sign the release for every trip — friction the shops flagged. The
signature retention model ([20260718-waiver-signature-retention](20260718-waiver-signature-retention.md))
must not be weakened: a completed release is immutable legal evidence, its template version is
snapshotted, and a later template edit cannot rewrite history. A signed waiver also carries a
**medical questionnaire**, so an old signature is not safety evidence forever. Staff also need to
record a release a diver signed on **paper** — a copy on the boat or handed over on shore — that
the app never sees signed.

## Decision

Denormalize `person_id` onto `waiver_records` (backfilled from the booking) so a completed
release is queryable per diver, and resolve the record that governs a booking's readiness through
one pure function, `effectiveWaiverForBooking` (`src/lib/waivers.ts`):

- A booking already covered by **its own** signed or in-medical-review record keeps that record —
  a stale clean waiver never overrides a live medical hold.
- Otherwise a diver's **current completed** release from any of their bookings carries over.
  "Current" (`isCompletedWaiverCurrent`) means: status `completed` (never `medical_review`), not
  superseded, signed against the shop's **current template version**, and within
  `WAIVER_SIGNATURE_VALIDITY_MS` (365 days) of `signedAt`.
- Otherwise the booking's own record (pending/expired/none) drives the normal send flow.

This resolution lives in exactly one place — `listTripReadiness` (`src/db/readiness.ts`) — which
already feeds the roster, the Today queue, the manifest, the check-in screen, and the fail-closed
boarding gate, so every surface agrees. The rule never lowers the bar: it only lets an existing
valid signature satisfy a new booking; it never invents readiness.

Staff-recorded paper signatures use the same immutable evidence shape. `recordInPersonWaiver`
inserts a `completed` record snapshotting the current template, marked with a new signature method
`in_person_attested` and stamped with the accountable staff member (`recorded_by_person_id`). It
supersedes any live pending link and is idempotent. The provider seam
(`inPersonAttestationProvider` in `src/lib/signatures.ts`) keeps the retention ADR's rule that no
route or query fabricates evidence outside a provider.

## Alternatives considered

- **A mutable person-level "waiver on file" flag** — the exact anti-pattern the retention ADR
  rejected; loses template/version evidence and audit history.
- **Carry forward forever, no validity window** — a three-year-old medical statement would auto-
  clear a diver whose fitness may have changed. Fails closed against safety.
- **Carry `medical_review` across trips too** — there is no "resolve medical review" action yet,
  so a carried hold could never clear; leaving it per-booking keeps the change additive and safe.
- **Add a `recorded_by` note string instead of an FK** — loses the queryable, referential link to
  the accountable staff person on a legal record.

## Consequences

Returning divers sign once until their signature ages out or the shop edits the release; the
roster shows "Waiver signed" (noting a paper copy) instead of a redundant "Send waiver". Editing
the template still invalidates carried signatures by design — new terms need a new agreement — so
a shop that edits its release frequently will re-prompt divers; that is the safe default. The
validity window and the template-version rule are the two knobs a future change would touch (e.g.
a shop-configurable retention period, or a "non-material edit" that does not force re-sign); both
are isolated in `src/lib/waivers.ts`. Revisit if shops need per-shop retention policy or a
medical-review resolution flow, either of which is a localized addition, not a re-model.
