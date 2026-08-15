# 20260802-crew-roll-call-attestation — Count crew into the head count with a per-checkpoint attestation

- **Status:** Superseded by [20260804-crew-roll-call-is-per-person](20260804-crew-roll-call-is-per-person.md)
- **Date:** 2026-08-02

## Context

Roll call is the safety spine: `roll_call_events` is append-only history that one staff member
marked one **booking** boarded, not boarded, or cleared. Crew — instructors, divemasters, the
captain — are not bookings. They are `trip_assignments` rows, and `roll_call_events.bookingId` is
`notNull` and is the *only* subject column, so there is no id a crew member could even be passed
as. `recordRollCall` validates its subject as a live booking and refuses anything else with
`booking_unavailable`; `recordedByPersonId` is the recorder, never the subject.

The consequence (comprehensive review 20260802, DOM-H1, High): the after-dive head count covered
booked divers only, excluding exactly the people most reliably in the water. "Complete" was defined
at the UI layer, twice, as `summary.totalDivers > 0 && summary.awaiting === 0` — once in
`manifest/page.tsx` and again in `OfflineManifestView.tsx`. A boat could read **"Roll call
complete ✦"** with a divemaster still down.

Two constraints shape what can be built today. `trip_assignments` has no per-trip role column (roles
are shop-wide on `person_roles`) and no `shop_id`, so "who is captain *of this trip*" is not
representable — that is DOM-M3, not fixed here. And `listTripCrew` dropped person ids, so nothing
downstream could address a crew member even if a write path had allowed it.

## Decision

Ship the interim slice the review calls for: a per-checkpoint **crew attestation** that blocks the
checkpoint from reading complete. Not a per-person crew roll call.

1. **A new table, `roll_call_crew_attestations`** — `(shop_id, trip_id, checkpoint, crew_aboard,
   crew_assigned, attested_by_person_id, note, occurred_at, created_at)`. Append-only, exactly like
   `roll_call_events`: a later attestation supersedes an earlier one without rewriting it, and there
   is no mutable "crew ok" boolean anywhere.

   **Not a widened `roll_call_events`.** Carrying crew there would have meant making `bookingId`
   nullable — weakening a NOT NULL invariant on the safety spine so that a *diver* event could also
   be written with no subject at all. The subject shapes genuinely differ (one booking vs. a count
   over a trip's assignments), so they are separate rows rather than one table with a nullable
   discriminator.

2. **The denominator is never client-supplied.** `recordCrewAttestation` reads `crew_assigned` from
   the trip's own assignments inside the transaction. Staff supply only `crew_aboard`, because that
   is the only number that comes from looking at people. Same tenancy, staff-role, trip-status and
   checkpoint gates `recordRollCall` applies, plus a `0..99` integer bound.

3. **One definition of complete**, `rollCallCompleteness` in `src/lib/manifests.ts`, consumed by
   both surfaces. Divers first (unchanged: an empty roster never completes; every booked diver needs
   a result), then crew: an attestation must exist and must cover at least as many crew as the trip
   has assigned **now** — not the denominator stored on the attestation, so assigning another crew
   member re-opens the checkpoint instead of riding on a stale count. Counting more aboard than
   assigned reads complete; an extra hand is accounted for, not missing.

4. **"0 of 0" is not an automatic pass.** A trip with no assigned crew is a scheduling gap (the app
   already nags about it as a coverage gap), not evidence nobody else was aboard, so a named human
   still has to say it. The alternative would hand back exactly the silent pass this check exists to
   remove, on precisely the trips whose crew data is worst.

5. **`listTripCrew` now returns person ids.** Nothing addresses a crew member individually yet, but
   dropping the id is what foreclosed the per-person future; keeping it costs nothing. Tenancy is
   proved through `trips`, because `trip_assignments` has no `shop_id`. The ids stay on the live
   manifest and are stripped from the offline snapshot, which only needs names.

6. **Offline: read-only in this slice, and it fails closed.** Crew attestation is not recordable
   from the offline manifest — that would need a new offline event kind, store, and sync-route
   surface. The saved snapshot carries the attestation, `OfflineManifestView` recomputes
   `rollCallCompleteness` with it, and a checkpoint with every diver counted and no crew attested
   reads **open** offline exactly as it does online, saying why. The divergence that would be worse
   than the original bug — offline "done", online "not done" — cannot occur. The snapshot record
   version is deliberately *not* bumped: the field is additive and optional, its absence is the
   fail-closed answer, and a bump discards records that fail to decrypt along with any roll call a
   crew member queued offline and has not synced.

Scope: this changes the manifest surfaces only. Today's `roll_call_unfinished` escalation
(`src/lib/today.ts`, DOM-H3) still reasons about diver events and is untouched here.

## Alternatives considered

- **Nullable `bookingId` on `roll_call_events` plus a `person_id`** — weakens a NOT NULL invariant on
  the safety spine for every existing diver row; a polymorphic subject that can be entirely absent is
  worse than two tables.
- **Per-person crew roll call now** — the real answer, but it needs `trip_assignments` to carry a
  per-trip role (DOM-M3) and a subject model that is not `bookingId`. Blocking the interim fix on it
  leaves boats sailing with the bug.
- **Derive crew completeness from `trip_assignments` alone** — an assignment list says who was
  rostered, never who is aboard. That is the mistake, restated.
- **A mutable `crew_ok` boolean on `trips`** — no time, no attester, no supersession; unauditable on
  the one surface where "who said so, and when" is the whole point.
- **Making a zero-crew trip auto-complete** — a silent pass on the worst-data trips (see 4).
- **Recording the attestation offline in this slice** — real work across the store, the event type,
  and the sync route; deferred deliberately, with the offline surface failing closed instead.

## Consequences

Every checkpoint now needs a human to count the crew before it closes, on a control sized for wet
hands. Shops that never attest will see checkpoints stay open — that is the intended pressure, and
it is visible rather than silent. A boat with no signal cannot close a checkpoint until it is back in
service; that is the cost of deferring offline recording, and it is the direction that errs toward
"not done".

Pairs with **HD-7**: whether the launch jurisdiction requires the head count to cover crew, and by
which mechanism (per-person roll call vs. attestation). If counsel says per-person, this table stays
as the count-level record and a per-person subject model is added beside it — that work needs DOM-M3
first. Revisit when either HD-7 lands or `trip_assignments` grows a per-trip role; migration cost is
one additive table plus a new subject column, with no rewrite of `roll_call_events`.

## Amendment 2026-08-03 — the follow-on landed; this ADR is not superseded

The revisit trigger above fired the next day. `trip_assignments` gained a per-trip role
([20260803-per-trip-crew-role](20260803-per-trip-crew-role.md)) and per-person crew roll call was
built on top of it ([20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md)),
exactly as this ADR's "Alternatives considered" said it would be.

Nothing decided here is reversed. `roll_call_crew_attestations` **stays** as the count-level record
and is still required for a checkpoint to read complete — retiring it was considered and rejected,
because it is the only thing that accounts for an extra hand nobody rostered and the only thing that
denies a zero-crew trip a silent pass. A checkpoint now needs a named result per rostered crew
member *and* this count.

Two statements above are narrowed by the follow-on rather than contradicted:

- **"Today's `roll_call_unfinished` escalation … is untouched here"** was true of this slice and
  remains a correct description of it. Today now does reason about crew, through the two *new*
  reasons `missing_crew` and `crew_uncounted`, which are raised by the per-person events only. **The
  count-level attestation in this ADR still raises no Today row**, deliberately: it is a form most
  shops have never filled in, so it would fire on nearly every trip and bury the rows that mean a
  person is in the water.
- **"Offline: read-only in this slice, and it fails closed"** was unchanged by the follow-on and
  covered both halves: neither the attestation nor the per-person roll call was recordable offline,
  and a checkpoint could not close out of signal.

  **Superseded 2026-08-14 for the per-person half** (H-46; see
  [20260803's amendment](20260803-per-person-crew-roll-call.md#amendment-2026-08-14--the-offline-half-was-built-the-record-version-bump-was-not-needed)).
  A rostered crew member can now be recorded aboard or not back aboard from a saved copy with no
  signal, so an after-dive checkpoint closes at sea. The **count-level attestation in this ADR is
  still not recordable offline, and nothing calls it at all** (ADR
  20260804-crew-roll-call-is-per-person) — so this is not a reopening of the attestation, and the
  fail-closed rule is untouched: a copy saved before crew ids rode along still cannot record its
  crew, absence is still "nobody has said", and the dock copy still never reads complete while the
  live page says the checkpoint is open.
