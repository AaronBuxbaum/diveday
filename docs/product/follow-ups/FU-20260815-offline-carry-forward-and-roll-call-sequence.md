# FU-20260815-offline-carry-forward-and-roll-call-sequence — Two more places the device and the server disagree about a head count

- **Status:** Open
- **Raised:** 2026-08-15 — `dive-domain-expert` review of the offline roll-call tie-break
  (`fix/offline-roll-call-tie-break`). Both pre-existing, both the same shape as the bug that change
  fixed: the device and the server answering one question differently.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/lib/manifests.ts`, `src/lib/offline-manifests.ts`,
  `src/components/OfflineManifestView.tsx`, `src/db/schema.ts`, `src/db/manifests.ts`

## What I noticed

Two independent findings, filed together because they share a cause and a reviewer. Either can be
taken alone.

### 1. Carry-forward is server-only, so an offline dock no-show has no honest answer

`carryForwardNotBoarded` (`src/lib/manifests.ts`) runs when the **server** assembles a manifest: a
diver marked not boarded at departure reads "not boarded · carried" at every later checkpoint, and
is accounted for. The device applies it only to what the snapshot already baked in.

So a diver marked **not boarded offline at departure** reads **awaiting** at `after_dive_1` on that
device, where online they would read "not boarded · carried".

The direction is safe — open, not closed. The trap is the wording. The only offline control that
will take a result for that person after a dive is **"Mark not back aboard"**, which at an
after-dive checkpoint means *did not return from a dive*. A crew member trying to tidy the count
writes a genuine missing-diver event about someone sitting in the marina parking lot: Today's
top-severity row, and a line in the departure log that an insurer may read. It does not even work —
`notBackAboard > 0` keeps the checkpoint open regardless.

**Fix:** run the existing pure `carryForwardNotBoarded` over local events on the device too, so a
diver the crew marked ashore at the dock reads "not boarded · carried" offline exactly as online.
It is already a pure function in `src/lib`, so it composes; the work is threading local events into
it and testing the interaction with the snapshot's own carried values.

### 2. The server read-back has no final deterministic tiebreak

Roll-call reads order by `desc(occurredAt), desc(createdAt)` and nothing else (`src/db/manifests.ts`).
`created_at` is `defaultNow()` — **transaction** time in Postgres. Two events applied in separate
transactions differ today, which is what makes the equal-timestamp tie rule resolve correctly and is
now pinned by tests. But it is a property of the clock's resolution, not of the data.

If `created_at` ever collides — a batched write inside one transaction, or somebody moving the
column onto the frozen application clock to make tests deterministic — the read-back order becomes
arbitrary and the device/server agreement this repo just established silently stops holding, with
every test still green. That is the same failure mode as the bug that prompted the review, one layer
down.

The repo already has the pattern: `activity_events` orders by `desc(occurredAt), desc(seq)`
(`src/db/operations.ts`). A monotonic sequence on `roll_call_events` and `roll_call_crew_events`
would make the tie rule a property of the data.

**Fix:** add the sequence column and use it as the final ordering key. It is a schema change with a
migration, which is why it is not a drive-by — see the **schema-change** skill, and note that
`pnpm check:migrations` refuses destructive DDL in a release window.

## Why it isn't already done

Both are outside the ordering fix that surfaced them, and neither is a defect visible in production
today: (1) is a wrong *word* on a device in a state that needs an offline dock no-show, and (2) is
latent rather than active. Both are the kind of thing that becomes a real incident exactly once, on
a boat, so they are worth writing down rather than remembering.

(2) in particular is a schema change on a safety-critical table and deserves its own review.

## Proposed change

Take them separately. (1) is pure-function plumbing and a handful of tests. (2) is a migration plus
an ordering change plus a test that a same-transaction batch still resolves to the later-queued
event.

**Not proposed:** moving `created_at` onto the frozen application clock to make tests deterministic.
That is the change that would *cause* (2) to bite, and the reason it is worth writing down before
somebody has the idea.

## Prompt

```text
Two places DiveDay's offline manifest and its server disagree about a head count. Read
docs/product/follow-ups/FU-20260815-offline-carry-forward-and-roll-call-sequence.md first. They are
independent -- do either, or both, but say which.

(1) carryForwardNotBoarded (src/lib/manifests.ts) runs only when the SERVER assembles a manifest, so
a diver marked "not boarded" OFFLINE at departure reads "awaiting" at after_dive_1 on that device
instead of "not boarded - carried". The only offline control that will take a result for them then
is "Mark not back aboard", which after a dive means "did not come back from a dive" -- so a crew
member tidying the count writes a genuine missing-diver event about somebody in the car park, and it
does not even close the checkpoint. Run the existing pure function over local events on the device
too. Mind the interaction with carried values the snapshot already baked in.

(2) src/db/manifests.ts orders roll-call reads by desc(occurredAt), desc(createdAt) and nothing
else. created_at is defaultNow() -- TRANSACTION time -- so the equal-timestamp tie rule the device
now matches is a property of the clock's resolution, not of the data. A batched write inside one
transaction, or anyone moving that column onto the frozen app clock, makes the order arbitrary and
silently breaks device/server agreement with every test green. Add a monotonic sequence and make it
the final ordering key; src/db/operations.ts's activity_events (desc(occurredAt), desc(seq)) is the
pattern. That is a schema change: read the schema-change skill, and note pnpm check:migrations
refuses destructive DDL in a release window.

Do NOT "fix" (2) by moving created_at onto the frozen application clock. That is the change that
makes the collision certain rather than hypothetical.

Both are safety-critical surfaces -- the screen that says who came back from a dive -- so get a
dive-domain-expert review, and a security-reviewer if you touch the schema. Run pnpm check and
pnpm e2e e2e/manifest.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260815-offline-carry-forward-and-roll-call-sequence.md when both are
done, or edit it down to whichever half remains.
```
