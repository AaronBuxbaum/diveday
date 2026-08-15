# 20260804-crew-roll-call-is-per-person — Retire the typed crew count; the named crew list is the whole crew half

- **Status:** Accepted
- **Date:** 2026-08-04
- **Supersedes:** [20260802-crew-roll-call-attestation](20260802-crew-roll-call-attestation.md);
  amends decision 3, 4 and 5 of
  [20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md)

## Context

Roll-call completeness has carried **two** crew halves since
[20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md): a result for every crew
member the trip names, *and* a typed count of bodies aboard, attested by a named human. The count
came first ([20260802-crew-roll-call-attestation](20260802-crew-roll-call-attestation.md)) as the
interim slice DOM-H1 asked for, when `roll_call_events` had no subject column a crew member could
occupy. The per-person model arrived a day later and 20260803 kept the count beside it, on one
argument: the count is the only thing that can speak for **a hand nobody rostered**, and for a trip
with an empty assignment list where there is no named person to ask about.

The product owner's report on the shipped surface is that "the whole *Crew aboard at Before
departure* thing is confusing", and asks for an **"Add crew to trip"** button in its place. Reading
the surface with that in front of you, the count does not survive its own panel:

- It asks the crew to re-state, as a number, a fact they have just recorded by name — on the page
  whose entire purpose is naming people, in the place where taps are most expensive.
- Its heading interpolates a checkpoint label into a sentence that reads as broken English
  ("Crew aboard at Before departure"), and its hint has to explain a denominator
  (`crewExpectedAboard`) that only exists because the two halves have to reconcile.
- Every refinement it has taken has been about that reconciliation: 20260803's D2 correction exists
  solely because the count and the named list disagreed about a crew member who called in sick, and
  the failure mode named there — "a crew that cannot close an honest count learns within two trips
  to type whatever number closes the box" — is a property of *having a box to type in*, not of the
  particular denominator.

The unrostered-hand argument does not hold up either. What the count actually captures is a
**number with no name on it**: it cannot say *who* the extra body was, so it cannot help a roll call,
an incident review, or anybody looking for a missing person. The honest way to account for someone
who sailed is to put them on the trip — which is a control that already exists, one tap away on the
Overview tab, and which is exactly what the product owner asked to surface here.

## Decision

1. **Delete the typed crew count from the product.** No manifest control, no server action, no
   contribution to completeness. `rollCallCompleteness` no longer takes `crewAttestation`, and
   `TripManifest` no longer carries one.

2. **The crew half is the named crew list alone.**
   `crewAccountedFor = crewAssigned - crewAshore > 0 && crewAwaiting === 0 && crewNotBackAboard === 0`.
   `crew_not_attested` and `crew_short` are gone. `crew_not_back_aboard` and `crew_awaiting` keep
   their meanings and their ordering, and divers still rank ahead of crew overall. The new
   `crew_none_aboard` ranks below both of those and above nothing: a stated, complete set of results
   that together say something impossible is not a clerical gap, but it is not somebody missing
   either.

3. **An empty boat is still not a free pass** — the one property of 20260802 worth keeping, and it
   has two shapes. **`crew_none_assigned`**: the trip names nobody. **`crew_none_aboard`**: the trip
   names crew, every one has a result, and every result is *ashore*. Both are a departure that
   sailed with nobody recorded running it, which is stronger evidence of an unrostered hand than of
   an empty boat, so both hold the checkpoint open. The closing rule is therefore "**at least one
   rostered body aboard**, and everybody rostered accounted for".

   The second shape was missed in the first draft of this decision and caught in review: without it,
   a trip whose whole crew was marked not-aboard at the dock closed every checkpoint and printed
   "everyone's accounted for" over a boat that had sailed with divers on it. Under the attestation
   that state still cost a human saying "0 aboard" out loud, so dropping the count must not make it
   free — a strict weakening this ADR would otherwise have shipped unnoticed.

   What changes in both cases is the way out. It used to be typing a number into a box; it is now
   the **"Add crew to trip"** button the manifest renders, which leads to the trip's own crew list.
   The resolution is a person's name, which is the thing the roll call is for.

4. **`crewExpectedAboard` is gone; `crewAssigned` replaces it** on `CrewRollCallCounts`. It existed
   only as the denominator the count had to cover. `crewAshore` stays and is load-bearing again: it
   is what `crewAssigned - crewAshore > 0` reads to decide whether anybody is aboard at all.

5. **The table, its rows, and its export stay.** `roll_call_crew_attestations` holds statements real
   humans made about departures that have already sailed; the incident export renders them and
   `roll_call_crew_attestations.csv` is a published data-portability contract. `recordCrewAttestation`
   is retained, unreachable from any surface and documented as such, so that dropping the table is a
   separate change with a migration in it rather than a side effect of a UI fix.

6. **`OFFLINE_MANIFEST_RECORD_VERSION` is not bumped.** A bump is a purge, and a purge discards any
   roll call a crew member queued offline and has not synced. A snapshot written before this change
   still carries a `crewAttestation` property; nothing reads it, and an inert extra property on a
   decrypted record is not worth a fortnight of dock copies. The offline crew panel keeps its three
   states and still fails closed: absence of a crew result reads as awaiting, never as accounted for.

## Alternatives considered

- **Keep the count, fix only its wording.** The heading and hint are fixable; the second tap on a
  wet boat, and the rubber-stamp pressure of a box whose default answer closes a checkpoint, are
  not. 20260803 already rejected retiring the count — on the unrostered-hand argument this decision
  re-examines and finds wanting, because an unnamed number cannot help anybody find a person.
- **Keep the count but make it optional (informational only).** A control that appears on a
  safety surface and affects nothing is worse than either alternative: it reads as a gate to the
  person tapping it.
- **Auto-complete the crew half when no crew are assigned.** This is the silent pass 20260802 was
  built to remove, and it would fire on precisely the trips whose crew data is worst.
- **Put "Add crew to trip" on the manifest as a full crew editor.** The trip's crew list is one
  screen away, is already the single home for assign/unassign (with per-person mutations that two
  staff can use at once), and duplicating it on the boat surface would be a second place for that
  logic to drift.

## Consequences

Closing a checkpoint is now strictly fewer taps: a result per named crew member, and nothing else.
Trips that were carrying an open checkpoint because nobody had typed a number — while every person
aboard had a recorded result — close on the next page load. That is the intended correction, not a
regression: those checkpoints were open on a formality, and open checkpoints that mean nothing are
what teach a crew to stop reading them.

A shop that sails with a hand nobody rostered now has no way to record that body **except by
rostering them**. That is a deliberate narrowing and the one real loss here — and it is a bigger
loss than "one tap on the Overview tab" suggests, which review made plain:

- It is only one tap if that person is **already a staff record with a staff role in this shop**.
  `changeTripCrew` re-proves `personRoles ∈ STAFF_ROLES`, so a fill-in captain, a mate borrowed from
  the shop next door, or the owner's son on school holiday must first be created at
  `/settings/team` — behind the owner/manager staff-accounts gate, which the divemaster running roll
  call at 06:50 with wet hands very likely cannot reach. None of it works offline, where the crew
  half is read-only by design.
- Rostering somebody onto a trip that already sailed **re-opens every checkpoint of that trip** (a
  new assignment is a new `crewAwaiting`), while Today stays quiet, because its after-dive
  population only counts people with a `boarded` result at departure. The only way to quiet the
  manifest is to retroactively tap "aboard" at every checkpoint for somebody nobody counted at the
  time — the same rubber-stamp pressure this decision attributes to a typed box, relocated to a
  per-person tap.

The honest reading is that this trade is right for the common case and worst for the shops with the
messiest crew data — the same shops the check exists for. The follow-on that would close it is a
one-tap "add someone who sailed" on the manifest itself, creating a minimal crew person inline; it
is not in this slice, and until it exists the fallback on those trips is a permanently open crew
panel, which is the failure mode both prior ADRs were written to avoid. Worth revisiting on the
first real report of it.

Trips with no crew assigned still cannot close a checkpoint, and now say so in the crew panel with
the button that fixes it rather than a number to type. Shops that never assign crew will meet this
on every trip — which is the same nag as before, pointed at the thing that would actually resolve it.

**Closed in this change: stripping a staff role no longer closes an open checkpoint.**
`listTripCrew` read the crew list through a `person_roles ∈ STAFF_ROLES` join, while
`removeStaffMember`, `setStaffRoles`, and `anonymizeDiver` all delete those rows and none of them
touches `trip_assignments`. So a divemaster recorded **not back aboard** at `after_dive_1` stopped
being counted the moment somebody removed them from the team: `crewNotBackAboard` fell to zero and a
checkpoint open *because a person did not come back* flipped to complete, with their
`roll_call_crew_events` rows still sitting there unread. The same class as the D3 failure 20260803
closed on `changeTripCrew`, reached through the team-management door instead — and this decision is
what made it bite, since before it the checkpoint usually stayed open anyway on `crew_not_attested`.

Membership is now one condition, `isOnTripCrew`: assigned, **and** either holding a staff role now
or already carrying a roll-call result on this trip. The crew list and `recordCrewRollCall`'s subject
check both read it, which is D11's rule enforced in both directions — a result can never exist about
somebody the head count cannot see, and somebody the head count is counting can never vanish out
from under a result already recorded about them. Employment ends; who was on the boat that day does
not change.

Two deliberate details. A former staff member kept on the list is still a valid roll-call *subject*,
so a checkpoint they are holding open can be closed by naming what happened to them rather than only
by deleting them. And "carrying a result" is any event, a `cleared` undo included: somebody whose
latest event is a clear reads as awaiting and holds the checkpoint open, which is the fail-closed
direction — the cost is a row a human has to call, and the alternative is a person disappearing.

The management surfaces are deliberately not widened. `listStaff` still offers only current staff to
*assign*, so nobody can roster an ex-employee onto a new trip, and the trip's crew section shows the
assignable set. Only the manifest — the safety record of a departure that happened — keeps the
person. A former staff member's row falls back to whatever job the roster recorded for them on that
trip, and shows no shop role, because they have none.

**HD-7** (whether the launch jurisdiction requires the head count to cover crew, and by which
mechanism) narrows rather than reopens: the per-person mechanism remains, and it is strictly more
informative than the count. If a jurisdiction turns out to require an attested *number*, the table
and its writer are still here, and the surface to put it on would be the shop's end-of-day close-out
rather than the boat.

## Amendment 2026-08-15 — the retired table is gone, not merely unused

`roll_call_crew_attestations` has been **dropped**, along with `recordCrewAttestation`, the
attestation timeline on the departure log, the `roll_call_crew_attestations.csv` file in the shop
export, and the seed and schedule-guard references to it (migration
`20260815221413_drop-roll-call-crew-attestations`, carrying the required
`-- diveday:allow-destructive` acknowledgement).

The decision above retired the *concept* and left the machinery standing because rows existed. That
reasoning does not survive [H-49](../../product/human-decisions.md) (2026-08-15, Aaron Buxbaum):
DiveDay is pre-pilot, there are no users, no data worth retaining, and no legacy code to keep. What
tipped it from a judgement call to a plain deletion is that the writer had **no production caller at
all** — the only three callers were its own tests, so the table was a schema object kept alive by
its own test suite, and the follow-up register had begun proposing migrations (a `seq` column, so
dead rows would sort deterministically) to maintain machinery nothing wrote.

Two paragraphs above are now stale in one respect each, and this amendment is where a reader is
told rather than left to discover it:

- The **HD-7** paragraph closes by saying that if a jurisdiction turns out to require an attested
  *number*, "the table and its writer are still here". They are not. HD-7 still narrows rather than
  reopens, and the answer is unchanged — the per-person mechanism stays, and it is strictly more
  informative than a count — but building the count back would now mean a new table, a new writer,
  and the surface named there (the end-of-day close-out, not the boat).
- The **glossary** no longer carries a `Crew attestation` entry: **Crew roll-call event** is the
  whole crew half of a head count, and there is no second half to distinguish it from.

What a shop's export bundle no longer contains: `roll_call_crew_attestations.csv`. Every other
roll-call file is unchanged, and the per-person `roll_call_crew_events.csv` — which names each crew
member rather than counting them — carries strictly more than the deleted file did. No row in it was
ever written by a shop, so the file could only ever have been a header line. The bundle's README is
generated from the file list, so it self-corrects.

Two consequences worth stating rather than leaving to be discovered:

- **The departure log's integrity code covers its timeline.** Removing the `crew_count` entry kind
  means a log regenerated now would hash differently from one printed earlier off the same
  departure — the failure mode that reads as tampering. It is empty in practice, because nothing
  ever wrote a row to hash, but it is the reason a *populated* table would not have been deletable
  this cheaply.
- **This is not expand/contract-clean, deliberately.** The previous release still reads the table in
  three places (the export bundle, its row-count query behind Settings, and the departure log), so
  those three surfaces 500 for the length of the production build window. Accepted under H-49 — no
  users, no data — and said plainly on the migration's acknowledgement line rather than papered
  over. A table with a real reader would have taken two deploys.
