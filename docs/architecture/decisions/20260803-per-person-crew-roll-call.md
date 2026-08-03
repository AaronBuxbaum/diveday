# 20260803-per-person-crew-roll-call — Give each assigned crew member their own roll-call subject, beside the count

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

[20260802-crew-roll-call-attestation](20260802-crew-roll-call-attestation.md) shipped the interim
slice DOM-H1 called for: a per-checkpoint **count** of crew aboard that stops a checkpoint reading
complete with a divemaster still down. It says plainly what it is not — "a count, not a per-person
roll call" — and names the follow-on: *"this table stays as the count-level record and a per-person
subject model is added beside it; that work needs DOM-M3 first."*

DOM-M3 landed ([20260803-per-trip-crew-role](20260803-per-trip-crew-role.md)), so it is time. The
gap the count leaves is exact: **"3 of 3 aboard" names nobody.** It cannot tell the boat that the
third body is the deckhand rather than the divemaster who has not surfaced, and a re-count taken by
the same tired human at the next checkpoint repeats the same undetectable mistake.

The constraints that shape this are the ones 20260802 already established. `roll_call_events`
carries a `notNull` `booking_id` as its only subject column, and widening it — making that column
nullable — would weaken a NOT NULL invariant on the safety spine so that a *diver* event could be
written with no subject at all. `rollCallCompleteness` in `src/lib/manifests.ts` is the single
definition of "this checkpoint is closed", consumed by the live manifest and the offline copy, and
must stay single. Offline recording of crew is a bigger change than 20260802's cost estimate
assumed: `OfflineRollCallEvent.bookingId` is a required string and the offline idempotency unique
key carries no subject kind.

## Decision

1. **A new table, `roll_call_crew_events`** — `(shop_id, trip_id, person_id, recorded_by_person_id,
   status, checkpoint, note, occurred_at, created_at)`. Append-only, with the same supersession and
   the same `cleared`-is-an-undo semantics as `roll_call_events`. `person_id` is the subject;
   `recorded_by_person_id` is who said so, routinely the same human. Not a widened
   `roll_call_events`, for the reason 20260802 gives: each table's subject column stays `notNull`.

   No `source` / `client_event_id` columns, because crew roll call is not recordable offline (6).

2. **Only an assigned crew member is a subject.** `recordCrewRollCall` re-proves, inside the
   transaction, that the person is on *this* trip's crew, joining through `trips` because
   `trip_assignments` carries no `shop_id` (CR-007). Being staff in the shop is not enough — the
   checkpoint's question is about the crew this trip *has*. No readiness gate: crew hold no booking,
   so there is no waiver or payment to check.

   **Correction (review 20260803, D11):** assignment alone was not enough either. The crew *list*
   (`listTripCrew`) filters to `STAFF_ROLES`, so a person who was assigned but held no staff role
   could carry events while appearing in neither the list nor the denominator — a result about
   somebody the head count could not see. The subject check now applies the identical filter.

   **And a subject cannot be removed.** `changeTripCrew`/`setTripCrew` refuse to take a crew member
   with roll-call history off the trip. Removing them deleted the row the result hangs off:
   `listTripCrew` dropped them, the assigned count fell, and a checkpoint open *because a named crew
   member did not come back* flipped to complete with the event rows unread (review 20260803, D3).
   `deleteTrip` and `moveTrip` count crew events and attestations as "already sailed" too — before,
   a bookingless crewed charter walked past the guard and deleted into a foreign-key violation.

3. **The attestation stays, and a checkpoint needs both.** They answer different questions: the
   events cover every crew member the trip *names*, and the count is the only thing that can speak
   for a hand nobody rostered — or for a trip with an empty assignment list, where there is no named
   person to ask about and "0 of 0" is still a sentence a human has to say out loud.

4. **Completeness stays one function** with a two-source crew predicate:
   `crewAccountedFor = attestation covers the crew still expected aboard && every named crew member
   is accounted for`.

   **"Expected aboard" is the assignment list minus anyone the per-person half already records as
   ashore** (review 20260803, D2). Measuring against `crew.length` meant three crew rostered, one
   marked `not_boarded` at the dock, and an honest "2 aboard" read `crew_short` at every checkpoint
   of that trip forever — with only a false number or deleting the person from the crew as exits.
   The two halves have to reconcile; a crew that cannot close an honest count learns to type
   whatever number closes the box. An after-dive `not_boarded` never reconciles, because there it
   means *did not come back*.

   `rollCallCompleteness` takes the **crew list**, not counts, and every field is required. The crew
   fields were optional numbers defaulting to `0`, so the one function that decides whether everyone
   is out of the water failed open by construction: supply the attestation, forget the per-person
   figures, and it returned `complete: true` with nobody named (D7). It also returns `crewReason`
   — the crew half's own reason, independent of the divers' — because a crew panel keyed off the
   single top `reason` shows "nobody has attested" on a boat where a named crew member is missing. "Accounted for" is the *same* predicate a diver's result goes through
   (`isRollCallAccountedFor` / `isNotBackAboard`), and crew results carry forward from the dock the
   same way — so a crew member marked not boarded at departure is ashore at every later checkpoint,
   while an after-dive `not_boarded` means *did not come back* and never carries (DOM-H3).

   `crew_not_attested` and `crew_short` keep working unchanged. Two codes are added and ordered
   deliberately: **`crew_not_back_aboard`** outranks every other crew reason, because a human has
   stated that somebody who was in the water has not come back and a satisfied count does not
   soften that; **`crew_awaiting`** ranks *below* `crew_short`, mirroring
   `divers_not_back_aboard` over `divers_awaiting` — a human who counted and came up short has
   stated an absence, while an untapped button is a clerical gap. Divers stay first overall.

5. **The counting rules 20260802 established are untouched**: compare against the crew assigned
   *now* rather than the attested denominator, and "0 of 0" is never an automatic pass.

6. **Offline stays read-only for crew, and fails closed.** The snapshot carries each crew member's
   saved result (names only — no person ids reach a crew phone, since nothing there can record one;
   the list is keyed by position, which is stable in a fixed saved slice and does not collide for
   two crew who share a name and a role, as `fullName-roles` did). `OfflineManifestView` recomputes
   completeness from that list. **Absence reads as awaiting**, so a snapshot saved before this
   existed reads *every* crew member as uncounted and the checkpoint stays open there exactly as it
   does online. The divergence that would be worse than the original bug — offline "done", online
   "not done" — cannot occur.

   The crew panel there has **three** states, not two (review 20260803, D6). Both crew halves are
   online-only and both are required, so on an out-of-signal trip every checkpoint is open for a
   reason nobody aboard can act on; rendering that in warning-yellow on every dive teaches the crew
   to stop reading the panel. "The crew half isn't recordable here" is stated neutrally, "a named
   crew member is not back aboard" is danger-toned, and accounted-for is success. Fail-closed is
   unchanged — only the tone distinguishes a limitation from an alarm.

   `OFFLINE_MANIFEST_RECORD_VERSION` is deliberately **not** bumped: a bump is a purge, and a purge
   discards any roll call a crew member queued offline and has not synced. The field is additive,
   optional, and its absence is the fail-closed answer.

7. **One control, generalized subject.** `RollCallButton` takes
   `subject: { field: "bookingId" | "personId"; id }` instead of a hardwired `bookingId`. The
   subject is the only thing that differs; the instant pending label, the confirm/refuse haptics,
   the `role="alert"` refusal, the no-JS form post, and the remount-key contract are all safety
   behaviour, and a sibling component would be a second place for them to drift.

   **Correction (review 20260803, D11):** this originally claimed the union "stops a caller posting
   a person id into the diver action". It does not — the union is structurally identical to a single
   `{ field: string; id: string }`, and nothing type-checks the pairing of a subject with an action.
   What actually protects the diver action is its own zod schema, which parses a `bookingId` field
   and rejects a form carrying `personId`, and the server-side re-proof of the subject inside each
   write.

## Alternatives considered

- **Nullable `booking_id` on `roll_call_events` plus a `person_id`** — weakens a NOT NULL invariant
  on the safety spine for every existing diver row. Rejected in 20260802; still rejected.
- **Retire the attestation now that crew are named** — leaves nothing to account for an extra hand
  nobody rostered, and hands a zero-crew trip the silent pass 20260802 exists to remove.
- **Per-person results as a veto only (absence tolerated when the count is satisfied)** — the count
  would still be closing the checkpoint over somebody nobody looked at, which is the finding.
- **Recording crew roll call offline in this slice** — needs a subject kind on `OfflineRollCallEvent`
  and on the offline idempotency key, plus store, sync-route, and reconciliation work. Deferred
  deliberately, with the offline surface failing closed instead.
- **A second, near-identical crew roll-call button component** — two homes for the safety behaviour
  on the control that closes a head count.

## Consequences

Every unclosed **after-dive** crew count now reaches Today and the schedule board on the same
terms a diver's does — same tone band, same urgency, same 48-hour dock-work window and 30-day
residue — through two new reasons, `missing_crew` and `crew_uncounted` (review 20260803, D1).
Before, the loudest signal the manifest has went nowhere at all. The count-level attestation
deliberately raises no queue row: it is a form most shops have never filled in, so it would fire on
nearly every trip and bury the rows that mean a person is in the water. The crew rows use the same
population rule the diver rows do — only somebody who actually boarded is in the water — so a shop
that has never tapped a crew roll call sees nothing new.

Every checkpoint now needs a named result per rostered crew member *and* a count. That is more taps
on a wet boat, on the surface where taps are most expensive — deliberately, because the crew are the
people most reliably in the water. Shops that only attest will see checkpoints stay open naming the
crew member nobody called, which is more actionable than the count-level "still open" it replaces.

A boat with no signal still cannot close a checkpoint: the offline copy now shows crew by name and
state but records neither half. That cost is unchanged from 20260802 and it errs toward "not done".

Still open: **HD-7** (whether the launch jurisdiction requires the head count to cover crew, and by
which mechanism) is unaffected — both mechanisms now exist, so HD-7 becomes a question about which
one is *required* rather than which one to build. Revisit the offline decision when a shop reports a
real out-of-signal checkpoint it could not close; the migration cost is a subject kind on the
offline event and its unique key, which is a record-version bump and therefore a purge.
