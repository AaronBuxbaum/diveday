# 20261015-roll-call-records-readiness — A count aboard keeps what readiness said

- **Status:** Accepted
- **Date:** 2026-10-15

**Amendment, 2026-11-14:** [20261114-trip-folio-and-individual-deck](20261114-trip-folio-and-individual-deck.md) adds an explicit physical-presence exception for an active held seat. Ordinary departure boarding still applies live readiness; the exception records unresolved blocker codes without granting eligibility.

## Context

A finished departure files a diver counted aboard while blocked under "Sailed" without the block.
Readiness is recomputed live: a card verified after departure hides the earlier state. Someone may
be counted aboard after a dive without clearing the dock, or readiness may lapse after boarding.
The record's domain review requested this follow-up (issues #2064, #2414).

## Decision

- `roll_call_events` gains `readiness_status` (`ready` or `blocked`) and `readiness_blockers`
  (jsonb, the blockers as the engine raised them). Both are written by `recordRollCall` with a
  `boarded` event, at every checkpoint, and are null on `not_boarded` and `cleared`. A check
  constraint holds that shape. The offline sync route writes through the same function, so a
  reconciled event keeps the reading of the moment the server applied it.
- The blockers are stored with their params, not as bare codes: several sentences take a level,
  a specialty or a form title, and a code alone would render a placeholder.
- **A record of what was true, never a gate.** Nothing reads the snapshot to allow or refuse a
  boarding; the dock still refuses a blocked diver from live readiness.
- A finished departure's Divers tab says it in danger text with no control: "Counted aboard (After
  dive 1) while blocked: ...", and the Sailed band says once how many. The earliest checkpoint a
  seat was counted blocked at is the one named; a count the crew later corrected or cleared names
  nothing (newest event per seat and checkpoint wins).
- The columns are in both CSV exports (`roll_call_events.csv`, codes only).

## Consequences

Past events carry null and say nothing; there is no backfill (H-20260815-no-legacy). Each after-dive `boarded` tap
now reads readiness inside its transaction, as the dock tap already did. A blocker added to the
engine later renders through `readinessBlockerText`, so an unknown stored code needs no migration. At an after-dive checkpoint the read runs in a savepoint: if it throws, the count is still written with a null snapshot and a `roll_call.readiness_snapshot_skipped` log line (the dock count still refuses). **Erasure** nulls `readiness_blockers` (the list names
why one person could not board, such as a physician's review) and keeps `readiness_status`, so the
row still says the count was made while blocked.

## Alternatives considered

- **Bare `readiness_blocker_codes`, as the issue proposed:** rejected, because a code without its
  params cannot render the sentences that name a level, a specialty or a form.
- **Recomputing "was blocked" from today's readiness:** rejected, it is exactly the lie this fixes.
- **Gating on the snapshot:** rejected; a count aboard is a head count of bodies, and refusing to
  record one corrupts the number that says nobody was left in the water.
