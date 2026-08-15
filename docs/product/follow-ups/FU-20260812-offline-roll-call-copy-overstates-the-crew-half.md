# FU-20260812-offline-roll-call-copy-overstates-the-crew-half — Make the crew half of the head count recordable offline, so the shipped copy becomes true

- **Status:** Open
- **Raised:** 2026-08-12 — drafting `docs/product/pilot-kit/cold-email-template.md`; a `dive-domain-expert` review of the email's offline sentence found the public pages already say more than the product does.
  **Rewritten 2026-08-14** after the owner chose the *build it* option over the *narrow the copy* option this entry originally proposed, and after a scoping pass found a schema prerequisite the original framing did not know about.
- **Kind:** improvement
- **Effort:** L
- **Touches:** `src/db/schema.ts`, `src/db/manifests.ts`, `src/app/api/offline-manifests/sync/route.ts`, `src/lib/offline-manifests.ts`, `src/lib/offline-manifest-store.ts`, `src/components/OfflineManifestView.tsx`, `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `e2e/manifest.spec.ts`

## What I noticed

Four shipped diver-facing strings say roll call works offline. The diver half does; **the crew half
does not**, and a checkpoint needs both. So offshore with the radio off, an after-dive checkpoint
**cannot be closed** — the one checkpoint where a person may still be in the water.

| Key | What it says |
| --- | --- |
| `marketing.pricing.faq.offline.answer` | "**Yes.** […] Departure and after-dive roll calls work from that copy" |
| `marketing.features.diveDay.item5` | "roll call keeps working with no signal — **every dive**" |
| `marketing.about.heroDescription` | "roll call works on a phone with no signal" |
| `switching.spreadsheet.wedge.manifestHeadCount.body` | "roll call keeps going when the signal doesn't" |

## The decision, and what changed about this entry

The original proposal was to **narrow the copy**. The owner chose the opposite on 2026-08-14:
**make the crew half work and keep the copy.** So the four strings above are no longer the
deliverable — they are the acceptance criteria. Do not narrow them.

The same conversation settled the data question this needs (**H-46**): crew person ids may enter the
offline snapshot, and more generally, pre-pilot, the fuller feature beats a tighter minimisation
posture. That is already recorded in `human-decisions.md`; this entry consumes it rather than
re-opening it.

## Why it isn't already done

Scoped on 2026-08-14 and deliberately stopped before the migration, at a clean boundary, rather than
left half-built. The client-side contract in step 4 below was written, typechecked and then reverted
— an offline write path with no server able to accept it is inert code on a safety surface, which is
worse than an entry that says exactly how to build it.

What makes it genuinely large is the prerequisite below, which the original "narrow the copy"
framing did not know about: this needs a schema migration before any of the interesting work starts.
It also needs two reviews and touches the one screen a captain uses when somebody may still be in
the water, so it wants a session with room to do it properly rather than the tail of one.

## The prerequisite the original framing missed

A scoping pass on 2026-08-14 got as far as the client-side contract and then found the blocker:

**`roll_call_crew_events` has no `source` and no `client_event_id` columns.** The diver table
(`roll_call_events`) has both, and they are exactly what makes offline sync safe:

- `clientEventId` gives idempotency — `recordRollCall` returns `{ duplicate: true }` for an event id
  it has already applied, so a retried sync cannot double-write.
- `offlineSnapshotSavedAt` plus `source: "offline"` give the staleness bounds and the newest-wins
  check (`src/db/manifests.ts`, the `source === "offline"` branch): an event whose snapshot is newer
  than the event, or whose occurrence is in the future, is refused as `snapshot_invalid`.

`recordCrewRollCall` has none of this. So this is **not** "thread a crew id through the existing
path" — it is a migration plus rebuilding those three protections for crew, and that is the half
where a mistake means a duplicated or out-of-order record of who came back from a dive.

That is why this entry is now **L**, not M.

## Invariants — break any of these and the change is worse than not doing it

These are collected here rather than left scattered through the steps, because each one is a rule
whose *reason* lives somewhere else in the codebase, and a reader who meets it as an aside in step 4
will reasonably think it is a preference. None of them are.

**I1 — Do not bump `OFFLINE_MANIFEST_RECORD_VERSION`.** A bump is a purge: a record that fails to
decrypt is overwritten with `events: []`, which throws away every roll call a crew member queued
offline and has not synced. That constant's own docblock already refuses a bump twice for exactly
this reason. An added optional field is additive and needs none.

**I2 — The new crew `id` is optional, and old snapshots must fail *closed*.** A copy saved before
this change has crew rows with no id; those crew members stay unrecordable on that copy and the
checkpoint stays open, exactly as it does today. The dangerous direction is offline reading *closed*
while online says otherwise — a checkpoint that looks finished while somebody is still in the water.
Every fail-closed path in this feature exists for that one sentence.

**I3 — Do not restructure `OfflineRollCallEvent` into a discriminated union.** Events already sitting
in a captain's IndexedDB carry `bookingId` and nothing else, and those are the events that must
survive: an unsynced result is a person somebody counted with no signal. A union keyed on a new
`subject` discriminant makes every one of them fail its own type the moment the app updates. Widen
additively instead.

**I4 — Mirror `recordRollCall`'s offline branch; do not invent a variant.** The two recorders should
be diffable side by side so a reviewer can see they agree on dedup, staleness bounds and
newest-wins. A crew-specific interpretation of any of the three is a bug waiting for the one week
somebody re-reads only one of them.

**I5 — Do not touch the sync route's auth gate.** Read its comment first. It is deliberately ahead
of the content-type and schema checks so an unauthorized caller's body is never parsed, and it
refuses the *request* rather than each event so a refused batch stays `pending` on the device
instead of being marked settled and losing its hold against the next purge.

## Proposed change

In this order, because each step is useless without the one before it.

1. **Migrate.** Add `source` (`rollCallSource`, default `live`) and `client_event_id` (uuid,
   nullable) to `roll_call_crew_events`, with the same partial unique index on
   `(shop_id, client_event_id)` the diver table carries. Additive only — no drop, no rename — so the
   destructive-migration guard passes without an allow line.
2. **Teach `recordCrewRollCall` the offline contract.** Mirror `recordRollCall`'s
   `source === "offline"` branch exactly: dedup on `clientEventId` before any other work, refuse on
   `snapshot_invalid` bounds, apply the newest-wins check. Mirror it rather than inventing a variant
   — the two should be diffable side by side, and a reviewer should be able to see they agree.
3. **Widen the sync route** (`src/app/api/offline-manifests/sync/route.ts`, 106 lines). Its zod
   `eventSchema` currently requires `bookingId`; it needs to accept **exactly one** of `bookingId`
   or `crewPersonId` and refuse both-or-neither, then dispatch to the matching recorder. The auth
   gate above it does not change and must not be touched — read its comment first, it is load-bearing.
4. **Widen the client contract.** This part was written and validated on 2026-08-14, then reverted
   rather than landed inert; rebuild it:
   - `OfflineManifestSnapshot.crew[]` gains an **optional** `id` (invariants **I1** and **I2**).
   - `OfflineRollCallEvent.bookingId` becomes optional and `crewPersonId` is added beside it
     (invariant **I3**). Add one reader, `offlineRollCallSubject`, that returns null when neither or
     both are set, and refuse that case in `appendOfflineRollCall` rather than writing an event
     nobody can attribute.
   - Add `canRecordOfflineCrewStatus` and `latestOfflineCrewRollCall` as siblings of the diver
     functions, not branches inside them. Crew differ in two ways: **no readiness gate at
     departure** (crew have none to read), and **a crew member with no id is refused** (an old
     snapshot fails closed). What is identical is that `not_boarded` is always recordable — after a
     numbered dive it means this person did not come back, and a gap in the saved copy never
     silences that.
5. **`OfflineManifestView.tsx`.** The crew section is currently read-only and says so in two
   docblocks and in `shared.offlineManifest.*` copy; give it the same controls the diver rows have,
   and rewrite those comments and strings — they are the in-product statement of the limitation this
   change removes. Both locales in the same change (`pnpm check:locale`).
6. **Tests.** The dangerous direction is offline reading *closed* while online says otherwise, so
   test that: an old snapshot with no crew ids keeps the checkpoint open; a duplicate
   `clientEventId` applies once; a stale snapshot is refused; `not_boarded` records at a checkpoint
   the snapshot has no manifest for.

**Reviews required before merge:** `dive-domain-expert` (this is the head count) and
`security-reviewer` (person ids entering a fortnight-retained device record, and a widened write
route).

Separately, and still true: the [V-02 run sheet](../pilot-kit/v-02-field-test-run-sheet.md) step 9
tests a **typed crew count** that ADR 20260804-crew-roll-call-is-per-person retired, so the field
test as printed hunts a field that no longer exists. Fix it in this change or file it — after this
lands, step 9 is the step that would actually verify the new behaviour.

## Prompt

```text
Make the crew half of DiveDay's roll call recordable offline, so that a captain offshore with the
radio off can close an after-dive checkpoint. Today divers can be counted with no signal and crew
cannot, so the checkpoint stays open -- and four shipped marketing strings already claim otherwise.

The owner has decided (2026-08-14): BUILD IT, do not narrow the copy. The four strings named in
docs/product/follow-ups/FU-20260812-offline-roll-call-copy-overstates-the-crew-half.md are the
acceptance criteria. H-46 in docs/product/human-decisions.md settles the data question: crew person
ids may enter the offline snapshot.

Read that follow-up file first -- its "Proposed change" is a validated six-step plan in dependency
order, and its "prerequisite" section explains the blocker that makes this large.

The blocker, so you find it early rather than late: roll_call_crew_events has NO `source` and NO
`client_event_id` column. The diver table has both, and they are what make offline sync safe
(idempotency on retry, staleness bounds, newest-wins). So step 1 is a migration and step 2 is
mirroring recordRollCall's `source === "offline"` branch into recordCrewRollCall. Mirror it so the
two are diffable side by side; do not invent a variant.

Read the "Invariants" section of that file before writing anything, and treat all five as
non-negotiable. They are collected in one place precisely so none is met as an aside: no
RECORD_VERSION bump, old snapshots fail closed, no discriminated union on the event, mirror
recordRollCall's offline branch rather than inventing a variant, and do not touch the sync route's
auth gate.

The failure direction that matters: offline reading "closed" while online says otherwise. Every
fail-closed path is deliberate. Test it.

Get a dive-domain-expert review (this is the head count) and a security-reviewer review (person ids
in a fortnight-retained device record, plus a widened write route). Run pnpm check, pnpm check:locale,
and pnpm e2e e2e/manifest.spec.ts. Triage the marketing visual diffs.

Delete docs/product/follow-ups/FU-20260812-offline-roll-call-copy-overstates-the-crew-half.md as part
of the change.
```
