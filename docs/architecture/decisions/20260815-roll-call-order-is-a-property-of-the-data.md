# 20260815-roll-call-order-is-a-property-of-the-data — Carry a not-boarded forward on the device, and order roll-call reads by a monotonic sequence

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

Two places the offline device and the server answered one question differently, both raised by a
`dive-domain-expert` review and filed as FU-20260815-offline-carry-forward-and-roll-call-sequence.

1. **Carry-forward was server-only.** `carryForwardNotBoarded` (`src/lib/manifests.ts`) ran when the
   *server* assembled a manifest, so a diver marked not boarded at the dock reads "not boarded ·
   carried" at every later checkpoint and is accounted for. The device applied it only to what the
   snapshot had already baked in — so a diver marked not boarded **offline at departure** read
   *awaiting* at `after_dive_1` on that device. The direction was safe (open, not closed); the trap
   was the wording. The only offline control that will take a result for that person after a dive is
   "Mark not back aboard", which there means *did not return from a dive* — so a crew member tidying
   the count writes a genuine missing-diver event about somebody in the marina car park, into a
   record an insurer may read, and it does not even close the checkpoint.
2. **The server read-back had no final deterministic tiebreak.** Roll-call reads ordered by
   `desc(occurred_at), desc(created_at)` and nothing else. `occurred_at` ties routinely (the e2e
   clock is frozen; an offline batch is applied with the timestamps the device recorded), and
   `created_at` is `defaultNow()` — **transaction** time in Postgres, identical for rows written in
   one transaction. Today the equal-timestamp tie resolves correctly because separate transactions
   differ, but that is a property of the clock's resolution, not of the data: a batched write inside
   one transaction, or anyone moving that column onto the frozen application clock to make tests
   deterministic, makes the order arbitrary and the device/server agreement stops holding **with
   every test still green**.

## Decision

1. **`carryForwardNotBoarded` becomes generic over the record shape and the device runs it** —
   the same function, not a second copy. It moves, with the rest of the dependency-free roll-call
   vocabulary (`RollCallCheckpoint`, `rollCallCheckpoints`, `isRollCallCheckpoint`,
   `RollCallRecord`, `isNotBackAboard`), into a new **`src/lib/roll-call.ts`**, re-exported from
   `src/lib/manifests.ts` so no existing import changes. That split is a bundling constraint, not
   taste: `offline-manifests.ts` is compiled into the offline service worker, esbuild resolves an
   import graph eagerly, and one *value* import from `manifests.ts` reaches `unavailableReadiness`
   → `readiness.ts` → `waivers.ts` → `node:crypto`, failing
   `scripts/build-service-worker.mjs` outright while `pnpm typecheck` stays green — a boat with no
   offline shell being the first symptom. `src/lib/roll-call.ts` imports nothing, and must stay
   that way. `latestOfflineRollCall`/`latestOfflineCrewRollCall` build
   the subject's **explicit** result at each checkpoint in `rollCallCheckpoints` order (device
   events first, then the snapshot's own non-implied entry) and run the chain over it. Carried
   values are therefore *recomputed* rather than trusted, which is what makes the interaction with
   the snapshot come out right in both directions: a dock result this device recorded carries
   forward even though the snapshot predates it, and an explicit `boarded` recorded here **breaks** a
   chain the server had carried, reopening the later checkpoints instead of leaving them reading
   "ashore, accounted for" about somebody now in the water. A checkpoint with no explicit result
   anywhere on the copy still falls back to whatever the snapshot holds, so a copy missing its
   departure manifest is no worse off than before.
2. **`roll_call_events` and `roll_call_crew_events` carry `seq bigserial not null`, and every
   roll-call read ends `desc(seq)`** — `listLatestRollCallByBooking`, `listLatestCrewRollCalls`,
   `listDepartureBoardedByTrip`, the newest-event lookups inside `recordRollCall`/`recordCrewRollCall`,
   and `updateLatestRollCallNote`. `activity_events.seq` is the same column for the same reason. The
   migration is additive (`ALTER TABLE … ADD COLUMN seq bigserial`, which in Postgres implies NOT
   NULL plus a sequence default, so existing rows backfill on rewrite); no drops, renames or type
   changes, and `scripts/check-migrations.mjs` passes.

   **`desc(createdAt)` deliberately stays *above* `desc(seq)`** rather than being replaced by it
   (both reviewers asked). A `bigserial` added to an existing table backfills in **physical heap
   order**, and `updateLatestRollCallNote` does a non-HOT `UPDATE` on exactly these rows, which
   relocates them — so a pre-migration row's `seq` is not reliably its write order, while its
   `created_at` is. Keeping the clock above the sequence orders historical rows correctly and lets
   `seq` do the one job it can always do: break the exact tie that had no answer at all. New rows
   are unaffected either way. What to know: the schema comment's "the only column that records what
   actually came first" is true of rows written after this migration, not of rows written before it.

   **The migration takes an `ACCESS EXCLUSIVE` rewrite** — `bigserial` expands to a volatile
   `nextval()` default, so this is not the fast-path `ADD COLUMN`, and migrations apply during the
   production build while the previous release is serving (security review, 2026-08-15). At
   pre-pilot row counts that is under a second and the simple DDL is worth more than the lock; if
   these tables ever carry a year of a busy shop's history, the lock-free shape is
   `ADD COLUMN seq bigint` → batched backfill ordered by `(occurred_at, created_at, id)` →
   `SET DEFAULT nextval(…)` → `SET NOT NULL`, which also makes the historical ordering deterministic
   and lets `created_at` come out of the ordering key.

## Alternatives considered

- **Move `created_at` onto the frozen application clock so tests are deterministic** — the change
  that would *cause* (2) to bite rather than fix it. Named here so the idea dies on sight.
- **Order by `id`** — `defaultRandom()`, so arbitrary, merely arbitrary consistently.
- **A composite unique on (subject, checkpoint, occurred_at)** — refuses the equal-timestamp write
  the offline path deliberately accepts, and an append-only safety trail must never lose an event.
- **Give the device its own carry-forward implementation** — two copies of the rule that decides
  whether somebody is accounted for is precisely the shape of the bug being fixed.

## Consequences

The device now reads "not boarded · carried" exactly where the live manifest does, so an offline
dock no-show is accounted for without anybody being told they did not come back from a dive. A
checkpoint can therefore close offline in a case where it previously stayed open — always and only
where the server would close it too **once this device's own pending events reach it**. (A dock
`not_boarded` that has not synced yet carries forward here while the live manifest, which has never
heard of it, holds the checkpoint open. That is the same asymmetry a pending `boarded` has always
had: the device is the authority on what its crew recorded, and a departure `not_boarded` means
"never left the dock", so nobody is in the water either way.) A carried value also inherits its
source's `pending` flag, so an after-dive row can read "Not boarded · carried · waiting to send" —
intended: the statement underneath it genuinely has not reached DiveDay.

The tie rule becomes a property of the rows. `seq` is one more column on two hot, append-only
tables; it is written by the sequence and read only as an ordering key, so it costs an index-free
bigint per row.

**Five readers outside the owned paths were left on the old key** and are filed as
`FU-20260815-two-roll-call-readers-still-tie-break-on-transaction-time`: `src/db/today.ts` (twice —
the queue that raises the missing-diver row, and the half of the DOM-H3 agreement that is now
guarded on one side only), `src/db/incident-export.ts` (twice — the departure log's timeline, whose
footer carries a SHA-256 over the printed facts, so a tie can print two orders and two hashes for
one unchanged record), and `src/db/export.ts`, which tie-breaks on `id` — `defaultRandom()`, so the
shop's own CSV of the safety trail is arbitrarily ordered on any tie. `maxRecordedDiveNumber`
(`src/lib/manifests.ts`, called from `src/db/trips-record.ts`) is in the same entry.

Revisit (2) only if `bigserial`'s sequence becomes a write-contention point on a shop's busiest
boat, which at DiveDay's scale it will not.
