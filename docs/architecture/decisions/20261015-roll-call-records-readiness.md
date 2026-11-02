# 20261015-roll-call-records-readiness — A count aboard keeps what readiness said

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

A finished departure's record files a diver who was counted aboard while blocked under "Sailed"
with no trace of the block. Readiness is recomputed live, so a card verified at 09:00 after a 05:30
boat reads Ready now and "was blocked" cannot be said truthfully afterwards. Two legitimate ways a
sailed seat was blocked: counted aboard at an after-dive checkpoint without clearing the dock
(Today raises `blocked_aboard` while the boat is out, issue #2064, then goes quiet once home), and
readiness lapsing after boarding. The dive-domain review of the record asked for the follow-up
(issue #2414).

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
