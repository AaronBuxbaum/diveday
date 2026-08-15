# FU-20260815-the-sailed-guard-counts-heads-without-naming-a-shop — Scope `countRollCallEvidence` to the shop, so the guard is safe at its own call site

- **Status:** Open
- **Raised:** 2026-08-15 — a `security-reviewer` pass on the change that dropped
  `roll_call_crew_attestations` (branch `follow-ups/round-two`), which edited this function and so
  put it under review. The reviewer's verdict on it was "style / defence-in-depth, not exploitable".
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/trips-schedule.ts`, `src/db/trips-schedule.test.ts`

## What I noticed

`countRollCallEvidence` (`src/db/trips-schedule.ts`) is the whole of the "this departure has
**sailed**, its date is no longer yours to edit" invariant that `moveTrip` and `deleteTrip` both
turn on. Both of its counters filter on `tripId` alone:

```ts
tx.select({ n: count() }).from(rollCallEvents).where(eq(rollCallEvents.tripId, tripId))
```

No `eq(rollCallEvents.shopId, shopId)`, on either. Both tables carry `shop_id` precisely so a read
never has to reach through `trips` to know whose row it is.

Nothing is broken today, and this is not a tenant-isolation bug: `moveTrip` and `deleteTrip` each
re-read the trip under `and(eq(trips.id, tripId), eq(trips.shopId, shopId))` with `.for("update")`
and return `not_found` before the count runs, so by the time it executes the trip is already proven
to belong to the session's shop — and every roll-call row for that trip is therefore that shop's.
An unscoped count could in any case only ever *over*-count, which refuses more, not less.

What is wrong with it is that a reader has to reconstruct all of that from the caller to know the
function is safe. This is a safety guard on the boat spine, and its safety is currently a property
of who happens to call it. The next caller — a bulk board operation, a cron tidying abandoned
departures, an admin tool — is the one that gets this wrong, and the failure it would produce is a
departure with a roll call being silently moved or deleted.

## Why it isn't already done

Out of the scope I was given. The task was to delete a retired table and every trace of it; I
touched this function only to remove its third counter (the attestation count, which had no writer
and so contributed 0 on every call). Two reasons not to do it as a drive-by:

- The function takes `(tx, tripId)`. Adding the scope means changing its signature and both call
  sites — a real edit to a safety-critical guard, not a one-liner, and it deserves to be reviewed as
  its own change rather than buried in a deletion.
- The change makes the count *narrower*, and a narrower count refuses **less**. It is a no-op today
  for the reason above, but "I made the already-sailed guard match fewer rows" is not a sentence
  that should appear unreviewed in a diff about deleting a dead table.

## Proposed change

In `src/db/trips-schedule.ts`, take `shopId` as a parameter —
`countRollCallEvidence(tx, shopId, tripId)` — and add `eq(rollCallEvents.shopId, shopId)` /
`eq(rollCallCrewEvents.shopId, shopId)` to the two counters via `and(...)`. Both call sites already
hold `shopId` in scope and have already proven the trip belongs to it, so this is a pure
tightening.

Keep the `queryAll` fan-out (`src/db/client.ts`) exactly as it is — both callers pass a
transaction, and `pnpm check:repo`'s transaction-concurrency rule refuses a `Promise.all` there
(issue #517). Do **not** "simplify" it back.

Not proposed: touching the `.for("update")` trip re-read in either caller, or changing what counts
as evidence. The set of tables that mean "this boat sailed" is settled — the divers' roll call and
the crew roll call — and narrowing or widening it is a different decision.

## Prompt

```text
In the DiveDay repo, tighten the tenant scoping of the "already sailed" guard.

Read first: src/db/trips-schedule.ts (the header comment, `countRollCallEvidence`, and both
`moveTrip` and `deleteTrip`), then src/db/trips-schedule.test.ts.

`countRollCallEvidence` counts roll-call rows by `tripId` only, with no `shop_id` filter, and it is
the whole of the invariant that stops a departure whose crew has begun counting heads from being
moved or deleted. It is not exploitable today — both callers re-read the trip under
`and(eq(trips.id, tripId), eq(trips.shopId, shopId))` with `.for("update")` and bail with
`not_found` first — but the guard's safety is a property of its callers rather than of itself, and
the next caller is the one that gets it wrong.

Change `countRollCallEvidence` to take `shopId` and add `eq(rollCallEvents.shopId, shopId)` and
`eq(rollCallCrewEvents.shopId, shopId)` to its two counters. Update both call sites, which already
have `shopId`.

Constraints that make this non-obvious:
- Both callers pass a transaction, so the fan-out MUST stay `queryAll` (src/db/client.ts), never
  `Promise.all` — `pnpm check:repo`'s transaction-concurrency rule refuses that, for issue #517.
- The change makes the count match FEWER rows, and a smaller count refuses less. Add a test that
  pins the behaviour: a trip with a roll-call event still refuses `moveTrip` and `deleteTrip` with
  `already_sailed`, and an untouched trip still deletes.

Done when: both counters name the shop, both callers compile, a regression test covers the refusal,
and `pnpm check` is green. Delete
docs/product/follow-ups/FU-20260815-the-sailed-guard-counts-heads-without-naming-a-shop.md as part
of the change.
```
