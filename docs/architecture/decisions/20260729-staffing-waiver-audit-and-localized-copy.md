# 20260729-staffing-waiver-audit-and-localized-copy — Staffing coverage, waiver integrity, and locale-ready copy

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

Trip assignments show who is on a specific manifest, but they do not show who is available across
the day. Signed waiver rows preserve application history, but a separate integrity check makes a
signed snapshot auditable if ordinary row history is incomplete. Manifest-affecting edits need one
repeatable failure-mode review, and public/capability copy should not make English an implicit data
model.

## Decision

Add four small seams around the existing operational spine:

- `staff_shifts` stores dated availability windows. Trip assignments remain the authoritative
  manifest crew list; a staffing view compares the two and reports coverage gaps.
- Completed waiver records receive an HMAC over their signed metadata and template snapshot.
  Records created before this field exists remain explicitly `unsealed`; a mismatch is an audit
  stop, not a best-effort warning.
- `reviewManifestChange` is a pure preflight checklist for roster loss, capacity shrinkage,
  orphaned roll-call history, missing course instructors, empty crew, and changed boarding gates.
  Existing transactional guards still enforce the blocking cases.
- Shops have a `default_locale`, and public/capability copy can use `LocalizedCopy` values while
  legacy strings continue to render. Locale selection is a fallback, not a claim that DiveDay has
  translated every English string yet.

## Why

Staff availability is not the same fact as trip assignment, and a manifest must not silently infer
one from the other. Waiver row history explains application writes but does not independently show
that signed metadata still matches the evidence captured at completion. Keeping both checks pure and
shop-scoped makes them testable and leaves room for a translation editor without changing the
meaning of course or waiver records.

## Alternatives considered

- **Infer working availability from trip assignments** — rejected; assignment is the boat's actual
  crew, not a shift or an availability promise.
- **Use a plain SHA-256 hash** — rejected; an HMAC gives a database-only editor less ability to
  forge a matching seal without the application secret.
- **Replace all existing text fields with locale-keyed JSON immediately** — rejected; it would make
  a translation migration a prerequisite for shipping operational safety work. Strings remain valid
  while new copy can use locale maps.

## Consequences

- The staffing page is useful with no shifts, but intentionally shows the missing coverage rather
  than fabricating availability.
- HMAC verification depends on `WAIVER_INTEGRITY_SECRET`, then `AUTH_SECRET`, with a development
  fallback for local fixtures. Production should set the dedicated secret before relying on the
  audit result.
- Existing seed and imported waiver records can be unsealed until they are re-created or a later
  backfill seals them from trusted source evidence.
- Translation management and per-copy locale editing remain follow-up work.
