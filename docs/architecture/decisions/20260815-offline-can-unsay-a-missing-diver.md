# 20260815-offline-can-unsay-a-missing-diver — Offline roll call gets `cleared`, and asserting "aboard" over a missing mark takes two taps

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

The live manifest's roll-call controls emit three things: `boarded`, `not_boarded`, and `cleared` —
the undo, which returns a row to *awaiting*. The offline vocabulary had two, so on the dock copy:

- **The two surfaces degraded differently on a mis-tap.** Online, tapping an already-active "Not
  back aboard" sends `cleared` and the count stays open and chased. Offline, the only neighbouring
  control queued **`boarded`** — a positive claim that this person is back on the boat — with no
  confirmation, from buttons that stack full-width and adjacent on a phone. One errant thumb, on a
  wet screen on a rolling boat, turned the app's loudest alarm green.
- **The honest correction was unavailable.** "I didn't mean to say she's missing" and "I have eyes
  on her, she's aboard" are different statements; offline could only make the second, so the
  append-only trail — which an insurer may one day read — held a sighting nobody made.

Raised by a `dive-domain-expert` review, filed as
FU-20260815-offline-cannot-unsay-missing-without-claiming-aboard. The follow-up asked for the
confirmation step first (the dangerous half) and left `cleared` as an open question, conditional on
it being additive: an `OFFLINE_MANIFEST_RECORD_VERSION` bump is a **purge** of every roll call a
captain has queued and not synced.

## Decision

Both halves, and neither makes retracting a mark harder than making one.

1. **A confirming second tap, naming the person, before asserting aboard over a stated "not back
   aboard".** `OfflineManifestView` holds one `confirmAboardFor` (a booking id or a crew person id;
   never more than one row armed, cleared on any record and on a checkpoint switch). The armed
   control reads "Confirm Maya is aboard" — a generic "Are you sure?" is the dialog people learn to
   dismiss without reading — beside a "Keep 'not back aboard'" way out. It applies to diver and crew
   rows alike, and **only** to a row where `isNotBackAboard` is true. Everything else on the surface
   stays one tap.
2. **`cleared` joins the offline vocabulary**, so a retraction is recorded as a retraction. Re-tapping
   an active "Not back aboard" (or a settled "Boarded ☑️") queues `cleared`, which is the grammar the
   live control has always had; the device reader collapses a latest `cleared` to "no result", the
   same collapse `listLatestRollCallByBooking` does server-side, and deliberately does **not** fall
   through to the snapshot underneath — a fallback there would hand back the mark just removed.
3. **A retraction only ever undoes a statement *this device queued*** (`OfflineRollCallResult.local`,
   added after the 2026-08-15 security review). An offline event is a blind newest-wins write —
   the server has no compare-and-set against the result the device was looking at — so a `cleared`
   aimed at a **snapshot** result could take another crew member's missing-diver mark off the boat
   on the strength of a copy up to fourteen days old. A row whose mark came from the snapshot keeps
   the pre-change behaviour and says where to undo it ("Recorded on another device or on the live
   manifest"). See Consequences for what a full fix would need.

**No `OFFLINE_MANIFEST_RECORD_VERSION` bump, and it is genuinely additive rather than argued into
being.** Nothing about the encrypted snapshot payload changes; this widens only the event records
written beside it. Old events (`boarded`/`not_boarded`) parse unchanged, `recordRollCall` and
`recordCrewRollCall` have accepted `cleared` since the live manifest had an undo, and the sync
route's schema grows one enum member. An offline `cleared` grants a device no new authority: it goes
through the same dedup on `clientEventId`, the same staleness bound, and the same newest-wins
refusal as every other offline status. `canRecordOfflineStatus`/`canRecordOfflineCrewStatus` allow
it for any known subject at any checkpoint, on the same reasoning that `not_boarded` is always
allowed — it puts nobody on a boat and closes no checkpoint.

## Alternatives considered

- **Confirmation only, no `cleared`** — closes the dangerous half but leaves the record dishonest
  and the two surfaces speaking different grammars on the same control, which is its own hazard for
  a captain working both minutes apart.
- **`cleared` only, no confirmation** — the mis-tap path stays one thumb away from turning an alarm
  green; the retraction helps only the crew member who notices.
- **Make a "not back aboard" mark sticky or confirmed to raise** — refused outright. Crews mis-tap
  constantly, and an alarm that cannot be retracted is an alarm crews stop raising.
- **A modal dialog** — a modal on a rolling boat is a target that moves under a thumb already in
  motion.
- **Confirming in place, on the control just tapped** — how this was first built, and wrong for
  exactly the failure it exists for: a double-tap or a bounce on a wet screen arms and confirms in
  one gesture (dive-domain review, 2026-08-15). The confirmation is therefore a **separate control
  below the row**, and the tapped control becomes "Keep 'not back aboard'" while it waits — so a
  bounce lands on the safe choice, and no timer is involved (a debounce would be measured against a
  clock the e2e fleet deliberately freezes).
- **Confirmation on the live manifest too** — not now. Live already has the honest undo one tap
  away and its buttons are driven by `useActionState`; the offline surface is where the asymmetry
  actually bites. Worth revisiting if a shop reports the same mis-tap on the live page.

## Consequences

The offline and live surfaces now share one undo model, and the departure log stops recording
sightings nobody made. One control on the whole surface takes two taps, and it is the one that can
silence a missing-diver alarm.

**What this does not fix, and the shape of the fix.** A retraction remains a blind newest-wins
write: `recordRollCall`/`recordCrewRollCall` refuse an offline event only when
`newest.occurredAt > occurredAt`, which is a timestamp comparison, not a compare-and-set against
the event being retracted (security review, 2026-08-15). Scoping the control to this device's own
statement is what keeps that from mattering in practice — the crew undo the tap they just made —
but a device that queued a mark, synced it, and retracts it an hour later can still land on a row a
second device has changed since. The full fix is to carry the identity of the result being retracted
(`retractsClientEventId`) and apply the `cleared` only if the newest event at that subject and
checkpoint still matches; it is filed as
`FU-20260815-an-offline-retraction-is-not-a-compare-and-set` because it needs a field on the queued
event, which widens `appendOfflineRollCall`. Note that this is not a regression: before this change
the same re-tap queued **`boarded`**, which overwrote the other device's mark *and closed the
count*. `cleared` resolves to awaiting, which keeps it open.

Escape hatch: dropping `cleared` again would mean the same additive change in reverse (the enum
member in the sync route, the collapse in the reader) plus deciding what a stored `cleared` event on
a device means — which is why the reader treats an unknown-to-it status conservatively rather than
optimistically. Removing the confirmation is a single state variable.
