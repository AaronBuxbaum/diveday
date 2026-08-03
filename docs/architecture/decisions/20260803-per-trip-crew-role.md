# 20260803-per-trip-crew-role — Carry the job a crew member is doing on `trip_assignments`, and name "in-water certified assistant" once

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Roles in DiveDay are shop-wide (`person_roles`): "Ana is a divemaster" is a standing fact about
Ana. `trip_assignments` had exactly two columns — `(trip_id, person_id)` — so the roster could say
who was aboard and never what they were doing there. The supervision ratio needs the other thing.

The consequence (comprehensive review 20260803, DOM-M3, Medium, safety): a divemaster rostered as
*this trip's boat captain* still counted as an in-water certified assistant and raised the ratio
capacity by two students per head, and a shop-wide instructor rostered as deck crew counted as the
session's instructor — worth eight students and enough on its own to clear `course_unstaffed`, the
gate that refuses enrolment on an unstaffed course session.

The rule itself — instructor = holds `instructor`; certified assistant = holds `divemaster` and not
`instructor`; `captain`/`crew` count as neither — was written out **five times in three idioms**
(two SQL, three in-memory): `src/db/bookings.ts`, twice in `src/db/today.ts`, `src/db/staffing.ts`,
and the trip page. The concept "in-water certified assistant" was named nowhere in `src/lib`.

Two write paths could silently discard a new column: `setTripCrew` is delete-all-then-insert, and
`changeTripCrew`'s assign used `onConflictDoNothing`. `trip_assignments` deliberately carries no
`shop_id` (CR-007); every reader proves tenancy through `trips`.

## Decision

1. **A nullable `trip_assignments.trip_role`**, a new `trip_assignment_role` enum of
   `instructor | divemaster | captain | crew` — a deliberate subset of `person_role` (`owner`,
   `manager`, `diver` are standing facts, never jobs on a boat).

   **Null means "not specified", which is the status quo and not a safety claim.** Every row
   written before this column existed is null and must keep counting exactly as it did: by
   shop-wide inference. The migration is additive with no backfill.

2. **One definition, `src/lib/crew-roles.ts`.** `inWaterCrewRole` / `countInWaterCrew` decide who
   is an instructor and who is an in-water certified assistant; all five call sites route through
   it, and it has its own direct tests (`src/lib/course-ratios.test.ts` takes bare numbers and
   never exercised the role→count mapping — that was the gap). `effectiveCrewRoles` is the display
   companion: what someone is doing on this sailing beats their standing list on a trip surface.

3. **A per-trip role can only ever narrow what a person is worth to the ratio, never raise it.**
   The role says which job they are doing; `person_roles` stays the evidence of what they are
   *qualified* to do, and the count takes the lesser. So an instructor working a trip as its
   divemaster counts as an assistant (a real, common downgrade), and rostering an unqualified
   deckhand as "instructor" buys the session nothing. A roster is a scheduling document; it must
   never be able to mint a credential. Asserted directly as a monotonicity test over every
   (shop roles × trip role) pair.

4. **Both crew write paths preserve the role.** `setTripCrew` reads existing roles inside its
   transaction and carries them forward for anyone who stays on the crew, so an ordinary "who is on
   this boat" edit cannot blank "Ana is captain of this sailing"; a caller overwrites a role only by
   passing one, and an explicit `null` clears it. `changeTripCrew` upserts with
   `onConflictDoUpdate` when — and only when — the caller named a role, so a role change on an
   existing assignment is applied instead of accepted-and-ignored, while a bare re-assign stays
   idempotent.

5. **Tenancy is unchanged.** `trip_assignments` still has no `shop_id`; the new reader
   (`getTripCrewAssignments`) proves membership through `trips`, like every other reader.

## Alternatives considered

- **Honour the per-trip role outright (a roster line makes you the instructor)** — lets a
  scheduling field grant an in-water credential; the exact failure the ratio exists to prevent.
- **A `NOT NULL` role with a backfill** — the backfill would have to guess a job for every existing
  row from shop-wide roles, writing a fabricated safety claim into history. Null-means-unspecified
  says the true thing.
- **A separate `trip_crew_roles` table** — a second row per assignment for one enum, with the same
  wipe risk on the delete-all write path and an extra join on every ratio query.
- **Leave roles shop-wide and filter captains out by their `person_roles`** — a captain who is also
  a divemaster is one person with two standing roles; nothing in the shop-wide model can say which
  one they are doing today.
- **Fix the five copies in place without extracting** — five copies is how this drifted in the
  first place, and it is a safety number.

## Consequences

A shop that never fills in a role sees today's behaviour exactly, everywhere. A shop that does gets
a tighter, truthful ratio — which can *reduce* seats on a session that was previously over-counting
its crew, and can newly surface `course_unstaffed` or `over_ratio` on a boat whose instructor is
really driving it. That is the intended correction, and it is visible rather than silent.

There is no UI yet for choosing a per-trip role: `CrewSection` and Today's departure board still
assign a person without one, and the seed sets roles that match each person's own shop-wide role
(so nothing about the seeded ratios moves). Adding the picker is the obvious follow-on and needs no
schema change.

Revisit if agencies start distinguishing roles this vocabulary cannot express (an assistant
instructor, a safety diver who is not the DM of record). Migration cost then is one enum value plus
a branch in `inWaterCrewRole` — the counting sites do not change, because there is only one.
