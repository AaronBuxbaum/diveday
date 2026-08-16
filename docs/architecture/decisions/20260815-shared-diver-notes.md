# 20260815-shared-diver-notes — Diver notes are person-scoped staff context shared with the live manifest

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

DiveDay already had `internal_notes` for a staff note attached to a booking. The table also has a
nullable `booking_id`, but the product only exposed the booking path: a note written while preparing
one departure was difficult to reuse on the diver's record, and a note written on the Diver page
had no shared path to the crew-facing manifest.

The note is operational context, not evidence. A sentence such as “first boat dive since the
course” can help the crew brief somebody well, but it must never make a diver ready, authorize
boarding, change capacity, or close a checkpoint. Free text also should not silently become a
medical or legal record.

## Decision

Keep one `internal_notes` source of truth and use its existing nullable booking association:

- a `booking_id` is present for a departure-specific desk note;
- a null `booking_id` is a person-scoped **diver note**;
- both rows retain the shop, subject, author, body, and timestamp, and writes/deletes append an
  activity event;
- the Diver record can add, list, delete, and undo person-scoped notes;
- the live boat manifest resolves person-scoped notes onto the diver's booking and renders them
  beside the row, separately from booking-scoped notes and checkpoint roll-call notes.

The manifest display is screen-only. Notes are not added to the printed departure document or the
minimized offline snapshot: a free-form staff note may contain private context, and spreading every
note to a paper copy or a crew device needs an explicit audience decision. The current shared
surface is the authenticated Diver record and live manifest.

There is one general operational note kind today. We will not add speculative kinds until a real
audience, retention period, and display policy exists; adding a kind later is a deliberate policy
change rather than a new label on an unrestricted textarea.

## Alternatives considered

**Copy booking notes onto the Diver record.** Rejected because edits, deletes, authorship, and
timestamps would drift between duplicate rows, and a booking note is not necessarily true for a
diver's future trips.

**Create a second notes table.** Rejected because it would split export, erasure, audit, and future
retention behavior for the same staff prose. The existing nullable association already models the
two scopes.

**Make notes a readiness input or a boarding override.** Rejected for safety: a note is an
unstructured human reminder, not verified certification, waiver evidence, or a head count.

## Consequences

- A staffer writes a diver fact once and the crew can read it on the live manifest.
- Booking-specific notes remain available and retain their existing Guests-tab behavior.
- No database migration is needed because the existing `internal_notes.booking_id` nullable column
  already supports person-scoped rows.
- Printed and offline manifests intentionally remain minimized; a future crew-visible note kind must
  make that audience and retention choice explicit before being copied there.
