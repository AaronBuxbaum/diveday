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
   `crewAccountedFor = crewAssigned > 0 && crewAwaiting === 0 && crewNotBackAboard === 0`.
   `crew_not_attested` and `crew_short` are gone. `crew_not_back_aboard` and `crew_awaiting` keep
   their meanings and their ordering, and divers still rank ahead of crew overall.

3. **Zero assigned crew is still not a free pass** — the one property of 20260802 worth keeping,
   now with a name of its own: **`crew_none_assigned`**. An empty crew list is a scheduling gap, not
   evidence that nobody else was aboard, so it holds the checkpoint open exactly as an uncalled crew
   member does. What changes is the way out. It used to be typing "0" into a box; it is now the
   **"Add crew to trip"** button the manifest renders in that state, which leads to the trip's own
   crew list. The resolution is a person's name, which is the thing the roll call is for.

4. **`crewExpectedAboard` is gone; `crewAssigned` replaces it** on `CrewRollCallCounts`. It existed
   only as the denominator the count had to cover. `crewAshore` stays — it is what makes a crew
   member recorded as staying ashore at the dock read as accounted for, at that checkpoint and every
   later one.

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
rostering them**. That is a deliberate narrowing, and it is the one real loss here. It trades a
number nobody could act on for a name somebody can, and the app already nags about unassigned crew
as a coverage gap.

Trips with no crew assigned still cannot close a checkpoint, and now say so in the crew panel with
the button that fixes it rather than a number to type. Shops that never assign crew will meet this
on every trip — which is the same nag as before, pointed at the thing that would actually resolve it.

**HD-7** (whether the launch jurisdiction requires the head count to cover crew, and by which
mechanism) narrows rather than reopens: the per-person mechanism remains, and it is strictly more
informative than the count. If a jurisdiction turns out to require an attested *number*, the table
and its writer are still here, and the surface to put it on would be the shop's end-of-day close-out
rather than the boat.
