# 20260815-an-offline-retraction-names-its-target — An offline `cleared` carries the event it undoes, and is refused when that event no longer stands

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

`cleared` joined the offline roll-call vocabulary earlier the same day (ADR
20260815-offline-can-unsay-a-missing-diver) so a mis-tapped "not back aboard" could be taken back as
a retraction rather than through "Mark aboard", which wrote a sighting nobody made. That ADR's own
Consequences named what it did not fix, and the security review that raised it filed
`FU-20260815-an-offline-retraction-is-not-a-compare-and-set`.

The gap: the only thing standing between a queued retraction and the server's current state is
`if (newest.occurredAt > occurredAt) return { ok: false, reason: "newer_event_exists" }`, in both
writers. That is a timestamp comparison, and `appendOfflineRollCall` stamps `occurredAt` at tap
time — so a retraction tapped *now* beats everything recorded before now. With no malice and no bug
in any single step:

1. 09:50 — device B records diver X **not back aboard** after dive 1. The missing-diver alarm.
2. 10:00 — device A, offline since 09:00, retracts its own earlier mark on X.
3. 10:05 — sync. 09:50 is not later than 10:00, so the retraction applies. X reads **awaiting**: B's
   alarm is gone, and `src/db/today.ts` drops X from its `notBackAboard` count with it.

That is fine for a *statement* — a later opinion supersedes an earlier one — and wrong for a
retraction, which is not an opinion about the diver at all. It says "the thing I said is not a thing
anybody said", and it can only be true of a specific thing.

The device-side mitigation already shipped: `OfflineRollCallResult.local` means the control offers a
retraction only over a statement **this device queued**, which covers the sequence above. What it
does not cover is a device that queued a mark, synced it, and retracts it an hour later, by which
time a second device has changed the row.

## Decision

**1. The queued event names its target, by the target's `clientEventId`.**
`OfflineRollCallEvent.retractsClientEventId` (optional), set by the four re-tap controls in
`OfflineManifestView` through one `reTap` helper, carried by `appendOfflineRollCall`, accepted by
the sync route's schema, and read by both writers.

The client event id and not a row id or a `seq`: the device mints it locally at queue time, which is
the only identity an event has while it is still sitting in the queue unsynced — and retracting a
mark that has not reached DiveDay yet is the ordinary case, not the exotic one. A `seq` is assigned
by the server, on a boat that by definition had no radio when the tap happened. A
status-plus-timestamp pair is not an identity at all: two taps share a millisecond under a coarse or
frozen clock, which is precisely the tie `latestQueuedAttempt` exists to break.

`OfflineRollCallResult` gains a matching `clientEventId`, set in `recordedResult` — the one function
both the diver and crew readers build a local result through, the same place `local` is set — so the
two halves of one head count cannot disagree about which event a row is showing.

**2. A retraction whose target no longer stands is REFUSED**, as
`{ ok: false, reason: "retraction_superseded" }`, through one shared `offlineRetractionSuperseded`
predicate both writers call — mirroring `offlineEventOutOfBounds` beside it.

Refusing is not chosen for sounding conservative; it is chosen because every case it can be wrong
about is a case where refusing is the safer direction, and because the device turns the refusal into
an alarm that *stays*:

- The newest event is another device's **`not_boarded`** — the sequence above. Applying would erase
  a missing-diver mark on the strength of a copy up to a fortnight old.
- The newest event is another device's **`boarded`** — somebody had eyes on the diver. Applying
  would return a settled row to *awaiting*, reopening a checkpoint a better-informed device closed.
- The newest event is already a **`cleared`**, or there is nothing at all. The retraction is a no-op;
  refusing costs nothing.

In all three the statement standing is newer than anything the retracting device saw, and undoing
*somebody else's* statement is what ADR 20260815-offline-can-unsay-a-missing-diver already forbids
on the device. The row's copy already says so: "Recorded on another device or on the live manifest —
undo it there, not here."

**And it does not conflict with the no-downgrade rule** (ADR
20260815-a-rejected-correction-may-not-silence-a-missing-diver), which says a rejected event may
never demote a stated "not back aboard". Read the composition: the refusal marks the `cleared`
`rejected` on the device, `explicitResultAt` defaults a rejected latest attempt to the snapshot, and
rescues the latest non-rejected local event **only when it states an alarm**. A retraction is never
itself rescued — it is the optimism the server refused. So after a numbered dive the alarm survives
the refusal, which is the direction that rule protects.

The cost is real and it is the right one to pay: a refused retraction leaves a mark on screen that
the crew tried to take back. But the mark left standing is not the crew's own mis-tap — that case is
exactly the one where the compare-and-set *matches* and the retraction applies. It is a newer
statement from a device that could see the water, and taking it off belongs where it was made.

**4. The refusal is spent, not just returned — the device reads `retraction_superseded` as evidence.**
Refusing on the server is not sufficient on its own, and reasoning "a refusal can only hold a count
open" is *false at `departure`* (dive-domain review, 2026-08-15). After a dive `not_boarded` means
*did not come back* and holding it keeps a checkpoint open. At the dock it means *never left* — an
**accounted-for** state that `carryForwardNotBoarded` propagates to every later checkpoint. So:

1. The tablet marks Priya ashore at the dock, syncs, and the next auto-save brings that value home
   in the snapshot.
2. Priya turns up late and the desk boards her on the live manifest.
3. The crew tap to take their mark back. The server refuses — correctly; the desk's sighting stands.
4. Left there, the device falls back to the snapshot's own dock `not_boarded`, carries it forward,
   and prints **roll call complete** after dive 1 about a diver who is in the water.

Which is DOM-H3's exact string, reached by a new door. So `retraction_superseded` is read on the
device as what it literally means — *the newest statement here is not the one you named*, i.e. the
server holds something this copy has not seen — and `explicitResultAt` then:

- reads the row down to **awaiting** (`null`, so nothing falls through to the snapshot the retraction
  was aimed at), **unless** the value that would stand is itself a stated "did not come back", which
  outranks this and every other rule. Awaiting is the fail-open answer: the count stays open and the
  crew are asked again, which is the same call ADR
  20260815-a-rejected-correction-may-not-silence-a-missing-diver made one door along;
- and, where a rescued alarm does stand, drops its `local`/`clientEventId` so the row stops
  advertising an undo that can no longer succeed. Without this the hint keeps reading "Tap 'Not back
  aboard' again to undo" and every tap queues another retraction refused identically — a livelock
  under copy promising the opposite, and a crew that taps the loudest row's undo into silence is a
  crew that stops using the control. The row instead says "Recorded on another device or on the live
  manifest — undo it there, not here", which the refusal has just made literally true.

The reason code is therefore a **contract between the writer and the device reader**, not a debug
string: it is one exported constant, `RETRACTION_SUPERSEDED` in the dependency-free
`src/lib/roll-call.ts`, so renaming it on the writer side is a `tsc` failure rather than a reader
that silently believes a stale value forever.

**3. A retraction naming nothing keeps the old behaviour, with no transition window and no expiry.**
An event with no `retractsClientEventId` is one queued by a build that predates the field — a phone
in a dry bag on a boat, which is the case this whole feature exists for. Refusing it would discard a
statement a crew member really made in order to enforce a rule their device cannot know about, and
losing roll call is the one thing this route is built never to do (it refuses whole batches rather
than marking events settled, for that reason). The device half — `local` — already scopes those
retractions to this device's own statement, which is what has been carrying the risk since the
morning of 2026-08-15; this is a strict tightening on top of it, never a replacement for it. A dated
window would be a rule needing a calendar entry, and no honest date exists: the devices it would cut
off are the ones with no signal.

**No `OFFLINE_MANIFEST_RECORD_VERSION` bump, and genuinely so.** That constant is the AES-GCM
additional data for the encrypted *snapshot*, and a bump is a **purge** of every roll call a captain
has queued and not synced. Nothing about the snapshot payload changes here; this widens only the
event records written beside it. Older events parse with the field undefined, undefined means "took
the pre-change path", and that path is still accepted. `newest.occurredAt > occurredAt` also stays
**strict** — an offline batch's second tap shares the first's timestamp under a coarse or frozen
clock and must still apply.

## Alternatives considered

- **Apply the retraction anyway and log the mismatch** — this is the state of the world before this
  ADR, and it is the one direction that can take a "did not come back from a dive" off a boat.
- **Refuse only when the newest event came from a *different* recorder** — narrower, and wrong: the
  same person on a second device, or the same person on the live manifest, produces exactly the
  sequence this exists to stop. What matters is whether the statement being retracted is still
  standing, not who made the one that replaced it.
- **Compare `status` + `occurredAt` instead of an id** — not an identity. Under the frozen e2e clock
  every offline event for one subject shares a timestamp, so a retraction would match a *different*
  device's event that happened to say the same thing at the same second.
- **Carry the server `seq` or row id of the target** — unavailable for the case that matters. An
  event still pending in the queue has no server identity, and asking the device to wait for one
  before it can offer an undo puts the honest correction behind a radio.
- **Widen the snapshot to carry each saved result's originating `clientEventId`, and let a
  retraction aim at a snapshot reading too** — relaxes `local`, and it needs the payload to carry a
  new field on every diver and crew row for a case the row already answers better in words. Left
  alone deliberately; the two guards are belt and braces, not one guard written twice.
- **Refuse a bare retraction after a fixed window (say 30 days)** — the window would have to be
  measured against a clock the e2e fleet freezes, and its whole purpose is to expire devices that by
  construction are not listening. It buys a tidier invariant and costs the roll call of the boats
  furthest from shore.
- **A new outcome reason vs. reusing `newer_event_exists`** — a distinct `retraction_superseded` is
  required, and by decision 4 it is load-bearing rather than cosmetic: the device changes what it
  displays on the strength of this code specifically, because it is the only refusal that says
  *which* thing is stale. `newer_event_exists` says "you are behind"; this says "the statement you
  named is not the one standing". Collapsing them would make the reader unable to tell them apart
  and would take decision 4 with it.
- **Refusing at `departure` and stopping there** — the first draft of this ADR, and wrong for the
  reason decision 4 sets out: at the dock the refused value is *accounted for*, so leaving it in
  place closes later checkpoints instead of holding one open.
- **Applying the retraction at `departure` when the standing event is a `boarded`** — the retraction
  would be asking for a state weaker than the one already recorded, so it cannot lower anything, and
  it would have fixed the same case. Rejected as a second rule about *which* statuses may overwrite
  which, on the write path, in a place where the current rule is one comparison. Reading the refusal
  on the device fixes it where the wrong value was being displayed, and needs no new server-side
  ordering.

## Consequences

An offline retraction is now a compare-and-set: it applies while it is about the statement standing,
and is refused otherwise, on both halves of the head count through one predicate. The mis-tap the
control exists for — undo the mark I just made — is untouched, because in that case this device's
event *is* the newest one.

A crew member can now see a `cleared` come back rejected. After a dive the row keeps reading "not
back aboard" and switches to "Recorded on another device or on the live manifest — undo it there,
not here"; at the dock it goes back to awaiting and asks again. The header's rejected count says a
correction needs attention, and the live manifest remains the authority.

**What this deliberately does not do.** It records no extra provenance column for whether a
retraction was checked. The target of an *applied* named retraction is derivable from the trail — the
compare-and-set guarantees it is the row immediately before it at that subject and checkpoint — so
the departure log an insurer reads is not missing the fact anyone would look for. A separate
`retracts_client_event_id` column would duplicate that derivable target, widen two append-only safety
tables, and still would not answer the operational question by itself. The unrecoverable provenance
question is therefore intentionally a metric question, not a trail-shape question: the two
`manifest.offline_retraction_superseded` and `manifest.offline_retraction_unnamed` counters record
refusals and legacy bare traffic without putting a person, booking, or note in the log. The bare
counter's target is zero; it is evidence for revisiting the compatibility rule, not a deadline that
changes it.

One nuisance worth naming rather than coding around: the sync route applies a batch oldest-first by
`occurredAt`, so if a tablet's clock steps *backwards* between a mark and its retraction, the
retraction sorts first, is refused for a target not yet inserted, and the mark it was taking back
then applies. The crew's next tap succeeds (the mark is standing, so a fresh retraction matches), so
it is recoverable, but it is the one way an honest same-device undo comes back rejected.

Reverting is the shared predicate, its two call sites, and the two branches in `explicitResultAt`.
The field itself stays inert on stored *device* events either way — it is never written to a
database row — which is the point of it being additive.
