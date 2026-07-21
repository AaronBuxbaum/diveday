# 20260719-crud-archive-semantics — Safe deletion for shop entities

- **Status:** Accepted for the current staff web app
- **Date:** 2026-07-19

## Context

Shop staff need a consistent way to correct records and remove stale catalog entries. Hard deletes
would erase the context needed for historical bookings, safety review, and equipment accountability.
The existing model already used terminal states for trips and gear, but the UI did not explain the
semantics consistently.

## Decision

Every active staff entity gets a create, edit, and deliberate remove action. Removal is soft:

- Divers use `people.deleted_at`; their bookings, certifications, and gear history remain intact.
- Certification cards (level, specialty, nitrox) use `deleted_at`; a deleted card leaves the diver's
  card list and stops counting toward readiness, but the row is retained for safety history. The
  identifier uniqueness index is partial on the live rows, so a renewed card can reuse the number.
- Dive sites use `dive_sites.deleted_at`; historical trip briefings remain readable, while new-trip
  pickers exclude the archived site.
- Courses archive with `courses.is_active = false`; existing sessions retain their admission
  snapshot and active catalog pickers exclude the course.
- Gear uses the existing `retired` state; checked-out gear cannot be retired.
- Trips use the existing `cancelled` state; cancellation removes the trip from active schedules.

Mutation controls are tenant-scoped and placed next to the record they affect. Destructive-looking
actions require an explicit disclosure step, and copy explains what history is preserved.

## Consequences

Operational history is safer and staff can recover context without database restoration. Queries that
populate active workspaces must filter the relevant archive marker; historical joins may intentionally
retain archived records so past trips and audits do not become incomplete.

## Alternatives considered

- **Hard-delete records** — rejected because it breaks historical context and can cascade through
  bookings, manifests, and assignments.
- **One generic `status` field for every entity** — rejected because safety states such as service
  hold, cancelled, and certification review have different meanings and invariants.
