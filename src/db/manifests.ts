import { and, asc, desc, eq, exists, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import { isStaff, STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { effectiveCrewRoles } from "@/lib/crew-roles";
import { rentalFitLine } from "@/lib/dive-prep";
import { log } from "@/lib/log";
import {
  type BuddyTeammate,
  buildTripManifest,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type ManifestCrewMember,
  RETRACTION_SUPERSEDED,
  type RollCallCheckpoint,
  type RollCallRecord,
  rollCallCheckpoints,
  type TripManifest,
} from "@/lib/manifests";
import { medicalWaiverMark } from "@/lib/waivers";
import { loadActiveStaffRoles } from "./authz";
import { listTripBuddyTeams } from "./buddy-pairs";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { rentalFitByBooking } from "./rental-fit";
import {
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips,
} from "./schema";
import { getShopById } from "./shops";
import { getTripRoster, getTripWithBooked } from "./trips";
import { liveTrip } from "./trips-live";

/**
 * "Is this person on this trip's crew?", as one SQL condition, so the crew
 * **list** and the roll-call **subject** check can never answer it differently.
 * That is the D11 finding (review 20260803) restated in both directions: a
 * result must never exist about somebody the head count cannot see, *and*
 * somebody the head count is counting must never vanish out from under a
 * result already recorded about them.
 *
 * Assigned to the trip, and either **holding a staff role now** or **already
 * carrying a roll-call result on this trip**.
 *
 * The second clause is the safety one. `removeStaffMember`, `setStaffRoles`,
 * and `anonymizeDiver` all delete a person's `person_roles` rows, and none of
 * them touches `trip_assignments` — so a staff-role-only rule dropped a
 * divemaster from *every* trip they had ever crewed the moment they left the
 * shop. A checkpoint held open **because they did not come back** then read
 * complete, with their `roll_call_crew_events` rows still sitting there unread
 * (dive-domain review 20260804). Employment ends; who was on the boat that day
 * does not change, and the manifest is a record of the second thing.
 *
 * `changeTripCrew` already refuses to *unassign* somebody with a result, so
 * the assignment this leans on is durable. This closes the other door.
 *
 * "Carrying a result" is **any** event, a `cleared` undo included. Somebody
 * whose latest event is a clear reads as awaiting and holds the checkpoint
 * open — the fail-closed direction, and the deliberate choice: the cost is a
 * row a human has to call, and the alternative is a person disappearing.
 */
function isOnTripCrew(db: DbExecutor, shopId: string, tripId: string) {
  return or(
    isNotNull(personRoles.role),
    exists(
      db
        .select({ present: sql`1` })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.shopId, shopId),
            eq(rollCallCrewEvents.tripId, tripId),
            eq(rollCallCrewEvents.personId, tripAssignments.personId),
          ),
        ),
    ),
  );
}

/**
 * The `people.id` of the staff member **writing** a head-count row, or `null`
 * when whoever is claiming to record it is not this shop's live staff right
 * now. Every writer in this file asks it, so the three of them can never answer
 * "who is allowed to write this" differently.
 *
 * Not to be confused with `isOnTripCrew` above, which is about the **subject**
 * of a result — a former divemaster stays a subject forever, because who was on
 * the boat that day does not change. This is about the **author**, and
 * employment very much does change that.
 *
 * The three writers each grew their own `person_roles` join instead, filtering
 * `people.id` / `people.shopId` / `person_roles.role` and stopping there. That
 * catches the case it was written for — a diver, or somebody demoted out of
 * every staff role — and misses the two `loadActiveStaffRoles` exists for: a
 * **deleted** person and a **disabled** account whose stale role row is still
 * there. Neither comes from `removeStaffMember`, which deletes every staff role
 * row and disables the account and never soft-deletes the `people` row — a
 * fully removed staff member was already refused. They come from two ordinary
 * shipped operations that touch roles not at all: `deleteDiver`
 * (`src/db/divers.ts`) sets `people.deleted_at` and nothing else, and
 * `setStaffAccountStatus` (`src/db/staff-accounts.ts`) revokes sign-in and
 * leaves `person_roles` entirely intact. Suspending an employee's login is the
 * everyday case, and it left them writing roll call. Both wrote real
 * `roll_call_events` rows attributed to somebody who could no longer sign in.
 * `/api/offline-manifests/sync` refuses both at the door, so nothing shipped was
 * exploitable — but a writer in `src/db` is inherited by every future call site,
 * and roll call is the record of who came back from a dive.
 *
 * So the join is gone and `src/db/authz.ts` is the one place the rule lives:
 * `loadActiveStaffRoles` takes a `DbExecutor`, so it composes inside these
 * transactions unchanged, and widening "who counts as live staff" happens once
 * for the role gates and these writers together. It costs two extra indexed
 * point-lookups per call — paid once per event, including down the sync route's
 * batch loop, which is the right trade against a head count signed by a name
 * that is not there.
 */
async function activeStaffRecorderId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

async function listTripCrew(db: DbExecutor, shopId: string, tripId: string) {
  const rows = await db
    .select({ person: people, tripRole: tripAssignments.tripRole, role: personRoles.role })
    .from(tripAssignments)
    // `trip_assignments` carries no shop_id of its own; proving the trip
    // itself belongs to shopId (not just the assigned person) is what closes
    // the cross-tenant read this table's shape allows (CR-007 review
    // finding — mirrors getTripCrewIds's already-fixed join, src/db/trips.ts).
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    // LEFT, not INNER, and the staff-role filter moved into the join: somebody
    // whose roles were stripped after they sailed has no `person_roles` row
    // left at all, so an inner join dropped them from a trip carrying their
    // recorded result. `isOnTripCrew` is what decides membership now.
    .leftJoin(
      personRoles,
      and(eq(personRoles.personId, people.id), inArray(personRoles.role, [...STAFF_ROLES])),
    )
    .where(
      and(
        liveTrip(),
        eq(tripAssignments.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        isOnTripCrew(db, shopId, tripId),
      ),
    )
    .orderBy(asc(people.fullName));
  // The person id is carried through, not dropped. It used to be, which is what
  // made a per-person crew roll call unreachable: no surface downstream could
  // address a crew member even if the write path had allowed it (ADR
  // 20260802-crew-roll-call-attestation). It is now that roll call's subject
  // (ADR 20260803-per-person-crew-roll-call). Tenancy is proven by the joins
  // above, through `trips`, because `trip_assignments` has no `shop_id`.
  const byId = new Map<string, ManifestCrewMember & { shopRoles: string[] }>();
  for (const { person, tripRole, role } of rows) {
    const crew = byId.get(person.id) ?? {
      id: person.id,
      fullName: person.fullName,
      // Straight off the person record — crew are `people` rows, so the columns
      // a diver's contact lives in were already here and already populated for
      // anyone who has ever been a diver at this shop. Nothing was stored; it
      // was simply never read into the crew payload (dive-domain review
      // 20260810).
      emergencyContactName: person.emergencyContactName,
      emergencyContactPhone: person.emergencyContactPhone,
      roles: [],
      shopRoles: [],
    };
    // Null for a former staff member kept on the list by their roll-call
    // history: they hold no shop role any more, so `effectiveCrewRoles` falls
    // back to whatever job the roster recorded for them on this trip.
    if (role) crew.shopRoles.push(role);
    // The job on *this* boat when the roster says so, otherwise the standing
    // roles — one definition, src/lib/crew-roles.ts.
    crew.roles = effectiveCrewRoles({ tripRole, shopRoles: crew.shopRoles });
    byId.set(person.id, crew);
  }
  return [...byId.values()].map(({ shopRoles: _shopRoles, ...crew }) => crew);
}

/**
 * The latest per-person crew roll-call result for one trip, keyed
 * `checkpoint\u0000personId`. Same "newest `occurredAt`, then `createdAt`"
 * supersession and the same "a latest `cleared` reads as no result" undo
 * semantics as `listLatestRollCallByBooking` — one rule for both subject kinds
 * (ADR 20260803-per-person-crew-roll-call).
 */
async function listLatestCrewRollCalls(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ event: rollCallCrewEvents, recorder: people })
    .from(rollCallCrewEvents)
    .innerJoin(people, eq(people.id, rollCallCrewEvents.recordedByPersonId))
    .where(and(eq(rollCallCrewEvents.shopId, shopId), eq(rollCallCrewEvents.tripId, tripId)))
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    );
  const latest = new Map<string, RollCallRecord>();
  const seen = new Set<string>();
  for (const { event, recorder } of rows) {
    const key = `${event.checkpoint}\u0000${event.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.status === "cleared") continue;
    latest.set(key, {
      state: event.status,
      occurredAt: event.occurredAt,
      recordedByName: recorder.fullName,
      note: event.note,
    });
  }
  return latest;
}

async function listLatestRollCallByBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
  checkpoint: RollCallCheckpoint,
) {
  const rows = await db
    .select({ event: rollCallEvents, recorder: people })
    .from(rollCallEvents)
    .innerJoin(people, eq(people.id, rollCallEvents.recordedByPersonId))
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        eq(rollCallEvents.checkpoint, checkpoint),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const latest = new Map<
    string,
    {
      state: "boarded" | "not_boarded";
      occurredAt: Date;
      recordedByName: string;
      note: string | null;
    }
  >();
  // Rows are newest-first, so the first row per booking wins. A latest `cleared`
  // event is staff undoing a mistake: record the booking as seen so no older
  // event resurfaces, but leave it out of the map so the diver reads as awaiting.
  const seen = new Set<string>();
  for (const { event, recorder } of rows) {
    if (seen.has(event.bookingId)) continue;
    seen.add(event.bookingId);
    if (event.status === "cleared") continue;
    latest.set(event.bookingId, {
      state: event.status,
      occurredAt: event.occurredAt,
      recordedByName: recorder.fullName,
      note: event.note,
    });
  }
  return latest;
}

/**
 * Who is aboard at departure, per trip — **the one reader of that fact.**
 *
 * Two callers ask this question for two different reasons: the counter
 * check-in queue wants the booking ids (is *this* diver aboard?), and Today's
 * departure board wants a head count per boat. They used to answer it with two
 * hand-written copies of the same query, and the copies had already drifted:
 * one applied the cancelled-booking guard, the other did not. Both now derive
 * from here, so "boarded" cannot mean two things in the same app.
 *
 * The rules, in one place:
 *
 * - **Latest event wins, not latest `boarded` event.** A later `cleared` is
 *   staff undoing a mistake, so it drops the diver back out — the same
 *   semantics `listLatestRollCallByBooking` applies.
 * - **A cancelled booking is nobody.** A seat pulled or refunded after the
 *   count keeps its roll-call row; without the join that stale "boarded" still
 *   counted, while `booked` (upcomingTripsWithCounts) had already dropped it —
 *   so the two totals could coincidentally agree with a real diver still
 *   unboarded. Same guard `recordRollCall` and the manifest's own roster apply.
 *
 * Read-only, and a count/roster question only: nothing here decides manifest
 * completeness, closes a checkpoint, or feeds the roll-call gap taxonomy.
 */
export async function listDepartureBoardedByTrip(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Set<string>>> {
  const byTrip = new Map<string, Set<string>>();
  for (const [tripId, states] of await listDepartureRollCallByTrip(db, shopId, tripIds)) {
    const aboard = new Set<string>();
    for (const [bookingId, state] of states) if (state === "boarded") aboard.add(bookingId);
    if (aboard.size > 0) byTrip.set(tripId, aboard);
  }
  return byTrip;
}

/**
 * The same read, one step earlier: each booking's **latest departure result**,
 * `boarded` or `not_boarded`, rather than only the set that boarded.
 *
 * Today's departure card needs the losing half too. "3 divers cannot board yet"
 * is a sentence about a gate still standing in front of somebody, and it was
 * being rendered about divers already on the boat and about divers the crew had
 * marked as never leaving the dock (issue #698). Telling those three states
 * apart needs the result, not the count.
 *
 * `not_boarded` **at departure** means "never left the dock" — benign, and
 * genuinely accounted for. That is the narrow reading `src/db/today.ts` sets
 * out at `isAccountedForAfterDive`, and it holds only because this query is
 * pinned to `checkpoint = "departure"`. The same status at an after-dive
 * checkpoint means the opposite and must never be read through this function.
 */
export async function listDepartureRollCallByTrip(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Map<string, "boarded" | "not_boarded">>> {
  const byTrip = new Map<string, Map<string, "boarded" | "not_boarded">>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .innerJoin(
      bookings,
      and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
    )
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        inArray(rollCallEvents.tripId, tripIds),
        eq(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  // Newest first, so the first row seen per booking is its latest event.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.bookingId)) continue;
    seen.add(row.bookingId);
    // A `cleared` row is staff undoing a mistake: the booking has a latest
    // event and it is neither result, so it drops out entirely rather than
    // being remembered as its previous one.
    if (row.status !== "boarded" && row.status !== "not_boarded") continue;
    const states = byTrip.get(row.tripId) ?? new Map<string, "boarded" | "not_boarded">();
    states.set(row.bookingId, row.status);
    byTrip.set(row.tripId, states);
  }
  return byTrip;
}

/**
 * **The crew half of the same question**, for a caller that has to answer
 * "is this checkpoint closed" without opening the manifest.
 *
 * The diver reader above was the whole of what Today knew, which is why Today's
 * departure card could throw confetti at `boarded === booked` while the
 * manifest, reading the same departure, correctly refused: a checkpoint closes
 * only when every booked diver *and* every assigned crew member is accounted
 * for. "Divers alone were never the whole boat" (`docs/product/glossary.md`,
 * issue #789).
 *
 * Deliberately the same shape and the same guards as its diver twin, one
 * function above, so the two can never drift into disagreeing about what a
 * latest result is. The `tripAssignments` join is the crew counterpart of that
 * one's cancelled-booking guard: somebody taken off the roster keeps their
 * event rows and must not answer for a crew list they are no longer on.
 */
export async function listDepartureCrewRollCallByTrip(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Map<string, "boarded" | "not_boarded">>> {
  const byTrip = new Map<string, Map<string, "boarded" | "not_boarded">>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: rollCallCrewEvents.tripId,
      personId: rollCallCrewEvents.personId,
      status: rollCallCrewEvents.status,
    })
    .from(rollCallCrewEvents)
    .innerJoin(
      tripAssignments,
      and(
        eq(tripAssignments.tripId, rollCallCrewEvents.tripId),
        eq(tripAssignments.personId, rollCallCrewEvents.personId),
      ),
    )
    .where(
      and(
        eq(rollCallCrewEvents.shopId, shopId),
        inArray(rollCallCrewEvents.tripId, tripIds),
        eq(rollCallCrewEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    );
  // Newest first, so the first row seen per person is their latest event.
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.tripId}\0${row.personId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A `cleared` row is staff undoing a mistake: the person has a latest event
    // and it is neither result, so they drop out entirely rather than being
    // remembered as their previous one.
    if (row.status !== "boarded" && row.status !== "not_boarded") continue;
    const states = byTrip.get(row.tripId) ?? new Map<string, "boarded" | "not_boarded">();
    states.set(row.personId, row.status);
    byTrip.set(row.tripId, states);
  }
  return byTrip;
}

/**
 * The flat view of {@link listDepartureBoardedByTrip}: every booking aboard
 * across the given trips. This is the manifest's half of the coupling task 149
 * closes from the other side (`checkedIn` on `ManifestDiverInput`) —
 * `checked_in` used to have exactly one reader in the app, the check-in page,
 * and boarding was invisible there.
 */
export async function listDepartureBoardedBookingIds(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  const byTrip = await listDepartureBoardedByTrip(db, shopId, tripIds);
  const boarded = new Set<string>();
  for (const aboard of byTrip.values()) for (const id of aboard) boarded.add(id);
  return boarded;
}

/**
 * The manifest is a derived safety view, never a separate roster people can
 * accidentally edit out of sync. Every active booking starts from the trip
 * roster and is joined with the shared readiness, fit, and roll-call records.
 */
export async function getTripManifests(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripManifest[] | null> {
  const trip = await getTripWithBooked(db, shopId, tripId);
  if (!trip) return null;
  const checkpoints = rollCallCheckpoints(trip.plannedDives);
  const [
    shop,
    roster,
    readinessRows,
    certified,
    fitByBooking,
    crew,
    crewRollCalls,
    buddyTeams,
    ...rollCalls
  ] = await Promise.all([
    getShopById(db, shopId),
    getTripRoster(db, shopId, tripId),
    listTripReadiness(db, shopId, tripId),
    verifiedNitroxPersonIds(db, shopId),
    rentalFitByBooking(db, shopId, tripId),
    listTripCrew(db, shopId, tripId),
    listLatestCrewRollCalls(db, shopId, tripId),
    listTripBuddyTeams(db, shopId, tripId),
    ...checkpoints.map((checkpoint) => listLatestRollCallByBooking(db, shopId, tripId, checkpoint)),
  ]);
  if (!shop) return null;
  const readinessByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.readiness] as const),
  );
  const depthByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.depthAdvisory] as const),
  );
  // When/how each diver's medical currency was last established, for spotting a
  // stale medical. Digital and staff-attested paper reviews both resolve here;
  // a pending/in-review record resolves to null.
  const medicalByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, medicalWaiverMark(row.waiver)] as const),
  );
  // Buddy teams, reduced to the members who are actually aboard. A member
  // whose seat was since cancelled stays listed (and dissolvable) on the teams
  // panel, but is dropped here: a cancelled seat is nobody (ADR
  // 20260804-buddy-teams), and an alert about a person who is not on the boat
  // would be a false alarm. A crew member is aboard as long as they are still
  // assigned to the trip, which `listTripCrew` is the authority on.
  //
  // What each row carries is the team **minus itself** — a team is a fact about
  // a group, a manifest row is a fact about one body. A team left with fewer
  // than two aboard puts nothing on any row: there is nobody left to diverge
  // from, and the panel already shows why.
  const rosterBookingIds = new Set(roster.map(({ booking }) => booking.id));
  const crewIds = new Set(crew.map((member) => member.id));
  const teamByBooking = new Map<string, ManifestBuddyTeam>();
  // Crew accumulate a *list*: one divemaster commonly leads several groups on
  // one boat, so unlike a diver they have no "at most one team" constraint.
  const teamsByCrewId = new Map<string, ManifestBuddyTeam[]>();
  for (const team of buddyTeams) {
    const aboard = team.members.flatMap((member): BuddyTeammate[] =>
      member.kind === "diver"
        ? !member.cancelled && rosterBookingIds.has(member.bookingId)
          ? [{ kind: "diver", bookingId: member.bookingId, fullName: member.fullName }]
          : []
        : crewIds.has(member.personId)
          ? [{ kind: "crew", personId: member.personId, fullName: member.fullName }]
          : [],
    );
    if (aboard.length < 2) continue;
    for (const member of aboard) {
      const others = aboard.filter((other) =>
        member.kind === "diver"
          ? other.kind !== "diver" || other.bookingId !== member.bookingId
          : other.kind !== "crew" || other.personId !== member.personId,
      );
      const carried = { teamId: team.teamId, others };
      if (member.kind === "diver") teamByBooking.set(member.bookingId, carried);
      else
        teamsByCrewId.set(member.personId, [
          ...(teamsByCrewId.get(member.personId) ?? []),
          carried,
        ]);
    }
  }
  // Age, minor status, and birthdays are all measured on the day the boat
  // sails, in the shop's own timezone — not "today" wherever the server is.
  const tripDate = calendarDateInTimezone(trip.startsAt, shop.timezone);
  const tripInput = {
    id: trip.id,
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    plannedDives: trip.plannedDives,
  };
  const diverInputs = roster.map(({ booking, person }) => {
    return {
      bookingId: booking.id,
      fullName: person.fullName,
      email: person.email,
      emergencyContactName: person.emergencyContactName,
      emergencyContactPhone: person.emergencyContactPhone,
      readiness: readinessByBooking.get(booking.id),
      rentalFit: rentalFitLine(fitByBooking.get(booking.id) ?? null),
      nitroxRequested: booking.wantsNitrox && certified.has(person.id),
      medicalWaiver: medicalByBooking.get(booking.id) ?? null,
      // Null/false whenever the shop holds no date of birth, so the captain's
      // list stays quiet rather than showing "unknown" down the whole boat.
      age: person.dateOfBirth ? ageOnDate(person.dateOfBirth, tripDate) : null,
      minor: person.dateOfBirth ? isMinorOnDate(person.dateOfBirth, tripDate) : false,
      birthday: birthdayCallout(person.dateOfBirth, tripDate),
      depthAdvisory: depthByBooking.get(booking.id),
      checkedIn: booking.status === "checked_in",
      buddyTeam: teamByBooking.get(booking.id) ?? null,
    };
  });
  // Carry a not-boarded result forward across the ordered checkpoints so an
  // after-dive list doesn't reset to "awaiting" for a diver who already left.
  const effectiveByBooking = new Map(
    diverInputs.map((diver) => [
      diver.bookingId,
      carryForwardNotBoarded(
        checkpoints.map((_, index) => (rollCalls[index] ?? new Map()).get(diver.bookingId)),
      ),
    ]),
  );
  // Crew results carry forward exactly like a diver's: a crew member marked
  // not boarded **at the dock** stays ashore at every later checkpoint until
  // an explicit result breaks the chain, and an after-dive `not_boarded` never
  // carries (it means "did not come back" — `carryForwardNotBoarded`, DOM-H3).
  const crewEffective = new Map(
    crew.map((member) => [
      member.id,
      carryForwardNotBoarded(
        checkpoints.map((checkpoint) => crewRollCalls.get(`${checkpoint}\u0000${member.id}`)),
      ),
    ]),
  );
  return checkpoints.map((checkpoint, index) =>
    buildTripManifest({
      trip: tripInput,
      checkpoint,
      crew: crew.map((member) => ({
        ...member,
        rollCall: crewEffective.get(member.id)?.[index],
        buddyTeams: teamsByCrewId.get(member.id) ?? [],
      })),
      divers: diverInputs.map((diver) => ({
        ...diver,
        rollCall: effectiveByBooking.get(diver.bookingId)?.[index],
      })),
    }),
  );
}

export async function getTripManifest(
  db: AppDb,
  shopId: string,
  tripId: string,
  checkpoint: RollCallCheckpoint = "departure",
): Promise<TripManifest | null> {
  const manifests = await getTripManifests(db, shopId, tripId);
  if (!manifests || !isRollCallCheckpoint(checkpoint, manifests[0]?.trip.plannedDives ?? 0)) {
    return null;
  }
  return manifests.find((manifest) => manifest.checkpoint === checkpoint) ?? null;
}

/**
 * How far an offline event's own timestamps may sit outside the order they
 * logically have to fall in — snapshot saved, then result recorded, then
 * synced — before the server refuses it. A boat tablet's clock is not the
 * server's, so a few minutes either way is ordinary; a snapshot that claims to
 * postdate the result recorded from it, or a result recorded in the future, is
 * not skew but a broken or forged event.
 */
const OFFLINE_EVENT_SKEW_MS = 5 * 60 * 1000;

/**
 * The `snapshot_invalid` staleness bound, shared by **both** offline recorders
 * (`recordRollCall` for a diver, `recordCrewRollCall` for a crew member).
 *
 * One function rather than the same four clauses written twice, because the
 * two halves of a head count disagreeing about what makes an offline event
 * stale is exactly the class of bug that outlives the week somebody re-reads
 * only one of them (the follow-up's invariant I4). Mirroring makes them
 * diffable; sharing makes them unable to differ.
 *
 * A missing `clientEventId` is out of bounds on purpose: without it the write
 * is not idempotent, so a retried sync would double-record who came back from
 * a dive.
 */
function offlineEventOutOfBounds(input: {
  clientEventId: string | undefined;
  offlineSnapshotSavedAt: Date | undefined;
  occurredAt: Date;
  now: Date;
}): boolean {
  const savedAt = input.offlineSnapshotSavedAt;
  return (
    !input.clientEventId ||
    !savedAt ||
    savedAt.getTime() > input.occurredAt.getTime() + OFFLINE_EVENT_SKEW_MS ||
    input.occurredAt.getTime() > input.now.getTime() + OFFLINE_EVENT_SKEW_MS
  );
}

/**
 * The compare-and-set an offline **retraction** is subject to, shared by both
 * writers (ADR 20260815-an-offline-retraction-names-its-target).
 *
 * `newest.occurredAt > occurredAt` — the refusal directly above both call sites
 * — is a timestamp comparison, and `appendOfflineRollCall` stamps `occurredAt`
 * at tap time, so a retraction tapped *now* beats everything recorded before
 * now. That is fine for a statement (a later opinion supersedes an earlier one)
 * and wrong for a retraction, which is not an opinion about the diver at all:
 * it says "the thing I said is not a thing anybody said". A device holding a
 * copy up to a fortnight old could therefore unsay a *different* device's "did
 * not come back from the dive", and `src/db/today.ts` would drop that diver
 * from its `notBackAboard` count with it.
 *
 * So a retraction names the event it undoes and applies only while that event
 * is still the newest one standing at this subject and checkpoint.
 *
 * **The identifier is the target's `client_event_id`, not its row id or `seq`.**
 * The device mints it at queue time (`crypto.randomUUID()` in
 * `appendOfflineRollCall`) — which is the only identity that exists for an
 * event the server has never seen, and the whole point is that a crew member
 * may retract a mark that is still sitting in the queue behind it. A row id or
 * `seq` is assigned here, on a boat with no radio, and a status-plus-timestamp
 * pair is not an identity at all: two taps share a millisecond under a coarse
 * or frozen clock, which is exactly the tie `latestQueuedAttempt` exists to
 * break.
 *
 * **A retraction naming nothing keeps the old behaviour**, deliberately and
 * with no expiry date on it. Those are events queued by a build that predates
 * the field, on a phone in a dry bag — the case this whole feature is for — and
 * refusing them would discard a statement a crew member really made to enforce
 * a rule their device cannot know about. The device half (`OfflineRollCallResult.local`,
 * ADR 20260815-offline-can-unsay-a-missing-diver) already scopes those to this
 * device's own statement, which is what has been carrying the risk since
 * 2026-08-15; this is a strict tightening on top of it, never a replacement.
 *
 * Read only for `cleared`. An event carrying the field with any other status is
 * a device bug, and it is *ignored* rather than refused: refusing would cost the
 * whole batch (the route answers non-2xx and the device keeps every event
 * pending) to punish a claim that grants no authority.
 */
function offlineRetractionSuperseded(input: {
  status: "boarded" | "not_boarded" | "cleared";
  retractsClientEventId: string | undefined;
  newest: { clientEventId: string | null } | undefined;
}): boolean {
  if (input.status !== "cleared" || !input.retractsClientEventId) return false;
  // Case-folded on both sides, because the sibling dedup lookup a few lines
  // above compares the same value *inside* Postgres against a `uuid` column,
  // where `AAAA…` and `aaaa…` are one value. Compared here as raw JavaScript
  // strings they are two, so one id would mean "the same event" for idempotency
  // and "a different event" for this check — and the disagreement would surface
  // as a silently refused correction on a missing-diver row (security review,
  // 2026-08-15). No producer sends uppercase today (`crypto.randomUUID()` is
  // lowercase); this is so the next client is not the one that finds out.
  //
  // `newest` undefined — nothing at all recorded here — mismatches too: the
  // statement this retraction is about is not standing, so there is nothing
  // for it to take back.
  return input.newest?.clientEventId?.toLowerCase() !== input.retractsClientEventId.toLowerCase();
}

/** Count offline retraction outcomes without putting person data in logs. */
function logOfflineRetractionSignals(
  input: {
    shopId: string;
    tripId: string;
    status: string;
    source?: string;
    retractsClientEventId?: string;
  },
  outcome: { ok: boolean; duplicate?: boolean; reason?: string },
): void {
  if (input.source !== "offline" || input.status !== "cleared" || outcome.duplicate) return;
  if (!input.retractsClientEventId) {
    log("manifest.offline_retraction_unnamed", "info", {
      shopId: input.shopId,
      tripId: input.tripId,
    });
  }
  if (!outcome.ok && outcome.reason === RETRACTION_SUPERSEDED) {
    log("manifest.offline_retraction_superseded", "warn", {
      shopId: input.shopId,
      tripId: input.tripId,
    });
  }
}

export type RecordRollCallOutcome =
  | { ok: true; eventId: string; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "booking_unavailable"
        | "staff_not_found"
        | "not_ready"
        | "invalid_checkpoint"
        | "newer_event_exists"
        /**
         * The statement being retracted no longer stands — see
         * {@link offlineRetractionSuperseded}. Spelled through
         * {@link RETRACTION_SUPERSEDED} at the two `return`s, because the
         * device reads this exact code back and reads a row down to awaiting
         * on it (`explicitResultAt`, src/lib/offline-manifests.ts).
         */
        | typeof RETRACTION_SUPERSEDED
        | "snapshot_invalid";
    };

/**
 * Roll call is append-only operational history. At departure, a boarded event
 * has an additional hard gate: the shared readiness service must prove the diver
 * ready at the moment staff board them. After-dive checkpoints are a physical
 * head count of who is on the boat — a diver whose paperwork lapsed after the
 * boat left is still aboard and must be recordable as present.
 */
export async function recordRollCall(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    recordedByPersonId: string;
    status: "boarded" | "not_boarded" | "cleared";
    checkpoint?: RollCallCheckpoint;
    source?: "live" | "offline";
    clientEventId?: string;
    /** The `clientEventId` a `cleared` undoes — see {@link offlineRetractionSuperseded}. */
    retractsClientEventId?: string;
    offlineSnapshotSavedAt?: Date;
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordRollCallOutcome> {
  const outcome = await db.transaction(async (tx): Promise<RecordRollCallOutcome> => {
    const checkpoint = input.checkpoint ?? "departure";
    const source = input.source ?? "live";
    const occurredAt = input.occurredAt ?? nowDate();
    const staffId = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };

    if (source === "offline" && input.clientEventId) {
      const [existing] = await tx
        .select({ id: rollCallEvents.id })
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, input.shopId),
            eq(rollCallEvents.clientEventId, input.clientEventId),
          ),
        )
        .limit(1);
      if (existing) return { ok: true, eventId: existing.id, duplicate: true };
    }

    const [booking] = await tx
      .select({ id: bookings.id, plannedDives: trips.plannedDives })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          ne(bookings.status, "cancelled"),
          eq(trips.status, "scheduled"),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "booking_unavailable" };
    if (!isRollCallCheckpoint(checkpoint, booking.plannedDives)) {
      return { ok: false, reason: "invalid_checkpoint" };
    }

    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const [newest] = await tx
        .select({
          occurredAt: rollCallEvents.occurredAt,
          clientEventId: rollCallEvents.clientEventId,
        })
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, input.shopId),
            eq(rollCallEvents.tripId, input.tripId),
            eq(rollCallEvents.bookingId, booking.id),
            eq(rollCallEvents.checkpoint, checkpoint),
          ),
        )
        .orderBy(
          desc(rollCallEvents.occurredAt),
          desc(rollCallEvents.createdAt),
          desc(rollCallEvents.seq),
        )
        .limit(1);
      if (newest && newest.occurredAt > occurredAt) {
        return { ok: false, reason: "newer_event_exists" };
      }
      // Second, and narrower: a retraction must still be about the statement
      // that is standing. Refusing leaves that statement in place, which is the
      // only direction that is safe here — the row this can be wrong about is a
      // diver somebody said did not come back from a dive, and the device turns
      // a refusal into an alarm that stays on screen rather than one that
      // quietly clears (ADR 20260815-a-rejected-correction-may-not-silence-a-missing-diver).
      if (
        offlineRetractionSuperseded({
          status: input.status,
          retractsClientEventId: input.retractsClientEventId,
          newest,
        })
      ) {
        return { ok: false, reason: RETRACTION_SUPERSEDED };
      }
    }

    // Readiness gates boarding at departure only. An after-dive checkpoint is a
    // head count of bodies on the boat: a diver whose card was pulled or payment
    // reversed mid-trip is still aboard, and refusing to record them present
    // would corrupt the one number that says nobody was left in the water.
    if (input.status === "boarded" && checkpoint === "departure") {
      const readiness = await getBookingReadiness(tx, input.shopId, booking.id);
      if (readiness?.status !== "ready") return { ok: false, reason: "not_ready" };
    }

    const [event] = await tx
      .insert(rollCallEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        bookingId: booking.id,
        recordedByPersonId: staffId,
        status: input.status,
        checkpoint,
        source,
        clientEventId: source === "offline" ? input.clientEventId : null,
        offlineSnapshotSavedAt: source === "offline" ? input.offlineSnapshotSavedAt : null,
        note: input.note?.trim() || null,
        occurredAt,
      })
      .returning({ id: rollCallEvents.id });
    if (!event) throw new Error("recordRollCall: insert returned no row");
    return { ok: true, eventId: event.id };
  });
  // A duplicate offline-sync replay changed nothing, so it raises no signal —
  // every genuine write does, live or offline-applied alike (both funnel
  // through this one function; see ADR 20260726-manifest-push-refresh).
  if (outcome.ok && !outcome.duplicate) {
    await publishManifestEvent(db, input.shopId, input.tripId);
  }
  logOfflineRetractionSignals(input, outcome);
  return outcome;
}

export type RecordCrewRollCallOutcome =
  | { ok: true; eventId: string; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "trip_unavailable"
        | "staff_not_found"
        | "crew_not_assigned"
        | "invalid_checkpoint"
        | "newer_event_exists"
        /**
         * The statement being retracted no longer stands — see
         * {@link offlineRetractionSuperseded}. Spelled through
         * {@link RETRACTION_SUPERSEDED} at the two `return`s, because the
         * device reads this exact code back and reads a row down to awaiting
         * on it (`explicitResultAt`, src/lib/offline-manifests.ts).
         */
        | typeof RETRACTION_SUPERSEDED
        | "snapshot_invalid";
    };

/**
 * Record one **assigned crew member's** result at one checkpoint. Append-only
 * history, the same shape `recordRollCall` writes for a diver: a later event
 * supersedes an earlier one and a `cleared` event is an explicit undo that
 * returns them to awaiting (ADR 20260803-per-person-crew-roll-call).
 *
 * The subject must be on *this* trip's crew list, proven inside the
 * transaction through `trips` — `trip_assignments` carries no `shop_id` of its
 * own (CR-007), so a bare trip UUID plus a personId from any shop would
 * otherwise be enough to write a head-count row against someone else's boat.
 * Being staff in the shop is not sufficient: a person nobody rostered is not a
 * subject, because the checkpoint's rule is about the crew this trip *has*.
 *
 * No readiness gate: crew hold no booking and therefore no readiness. What
 * gates a diver at departure — waiver, payment, certification — is not a
 * question anyone asks of the divemaster.
 *
 * **The `source === "offline"` branch is `recordRollCall`'s, mirrored.** Read
 * the two side by side: dedup on `clientEventId` before any other work, the
 * shared `offlineEventOutOfBounds` staleness bound, then newest-wins against
 * this subject's own history at this checkpoint. They agree because a
 * crew-specific interpretation of any of the three is how a device retry
 * double-writes, or an out-of-order one overwrites, the record of who came back
 * from a dive — and this half exists so a captain offshore can close an
 * after-dive checkpoint at all (H-46).
 */
export async function recordCrewRollCall(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    personId: string;
    recordedByPersonId: string;
    status: "boarded" | "not_boarded" | "cleared";
    checkpoint?: RollCallCheckpoint;
    source?: "live" | "offline";
    clientEventId?: string;
    /** The `clientEventId` a `cleared` undoes — see {@link offlineRetractionSuperseded}. */
    retractsClientEventId?: string;
    offlineSnapshotSavedAt?: Date;
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordCrewRollCallOutcome> {
  const outcome = await db.transaction(async (tx): Promise<RecordCrewRollCallOutcome> => {
    const checkpoint = input.checkpoint ?? "departure";
    const source = input.source ?? "live";
    const occurredAt = input.occurredAt ?? nowDate();

    const staffId = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };

    // Idempotency first, exactly as the diver path does it: a sync the device
    // retried (the response never arrived, the tab was closed mid-flight) must
    // not append a second row, and answering `duplicate` before any subject
    // lookup means a replay costs nothing and cannot be refused by a roster
    // that has changed since.
    if (source === "offline" && input.clientEventId) {
      const [existing] = await tx
        .select({ id: rollCallCrewEvents.id })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.shopId, input.shopId),
            eq(rollCallCrewEvents.clientEventId, input.clientEventId),
          ),
        )
        .limit(1);
      if (existing) return { ok: true, eventId: existing.id, duplicate: true };
    }

    // Same tenancy and trip-status gate the other two writers apply.
    const [trip] = await tx
      .select({ id: trips.id, plannedDives: trips.plannedDives })
      .from(trips)
      .where(
        and(
          liveTrip(),
          eq(trips.id, input.tripId),
          eq(trips.shopId, input.shopId),
          eq(trips.status, "scheduled"),
        ),
      )
      .limit(1);
    if (!trip) return { ok: false, reason: "trip_unavailable" };
    if (!isRollCallCheckpoint(checkpoint, trip.plannedDives)) {
      return { ok: false, reason: "invalid_checkpoint" };
    }

    // `isOnTripCrew` — the identical condition `listTripCrew` reads the crew
    // list through, which is the whole point of it being one function. Without
    // it this accepted a subject who was assigned but held no staff role and
    // no history: their events were written, and then neither the crew list
    // nor the denominator ever mentioned them, so a result existed about
    // somebody the head count could not see (review 20260803, D11). It also
    // *keeps accepting* a former staff member who is still on the list because
    // of a result already recorded — so a checkpoint they are holding open can
    // still be closed by naming what happened to them, rather than only by
    // deleting them.
    const [assigned] = await tx
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(
        personRoles,
        and(eq(personRoles.personId, people.id), inArray(personRoles.role, [...STAFF_ROLES])),
      )
      .where(
        and(
          liveTrip(),
          eq(tripAssignments.tripId, input.tripId),
          eq(tripAssignments.personId, input.personId),
          eq(trips.shopId, input.shopId),
          eq(people.shopId, input.shopId),
          isOnTripCrew(tx, input.shopId, input.tripId),
        ),
      )
      .limit(1);
    if (!assigned) return { ok: false, reason: "crew_not_assigned" };

    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const [newest] = await tx
        .select({
          occurredAt: rollCallCrewEvents.occurredAt,
          clientEventId: rollCallCrewEvents.clientEventId,
        })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.shopId, input.shopId),
            eq(rollCallCrewEvents.tripId, input.tripId),
            eq(rollCallCrewEvents.personId, assigned.personId),
            eq(rollCallCrewEvents.checkpoint, checkpoint),
          ),
        )
        .orderBy(
          desc(rollCallCrewEvents.occurredAt),
          desc(rollCallCrewEvents.createdAt),
          desc(rollCallCrewEvents.seq),
        )
        .limit(1);
      if (newest && newest.occurredAt > occurredAt) {
        return { ok: false, reason: "newer_event_exists" };
      }
      // The same compare-and-set the diver path applies, through the same
      // predicate — a crew-specific reading of when a retraction is still about
      // the statement standing is how the two halves of one head count start
      // disagreeing about whether a divemaster is still in the water.
      if (
        offlineRetractionSuperseded({
          status: input.status,
          retractsClientEventId: input.retractsClientEventId,
          newest,
        })
      ) {
        return { ok: false, reason: RETRACTION_SUPERSEDED };
      }
    }

    const [event] = await tx
      .insert(rollCallCrewEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        personId: assigned.personId,
        recordedByPersonId: staffId,
        status: input.status,
        checkpoint,
        source,
        clientEventId: source === "offline" ? input.clientEventId : null,
        // No `offlineSnapshotSavedAt` counterpart: the diver row keeps it as
        // evidence of which snapshot supplied the *readiness* it boarded on,
        // and a crew member has no readiness to evidence. It is still an input
        // above, where the staleness bound is computed from it.
        note: input.note?.trim() || null,
        occurredAt,
      })
      .returning({ id: rollCallCrewEvents.id });
    if (!event) throw new Error("recordCrewRollCall: insert returned no row");
    return { ok: true, eventId: event.id };
  });
  // Same push signal the other head-count writes raise: this changes whether
  // the checkpoint reads complete on every device holding the manifest open —
  // and, as on the diver path, a duplicate offline replay changed nothing, so
  // it raises none.
  if (outcome.ok && !outcome.duplicate) {
    await publishManifestEvent(db, input.shopId, input.tripId);
  }
  logOfflineRetractionSignals(input, outcome);
  return outcome;
}

/**
 * Annotate the diver's current roll-call result at a checkpoint. The note is an
 * annotation on the latest decision, not a decision of its own, so it updates
 * that event in place rather than appending — the recorded boarded/not-boarded
 * fact is never rewritten. Returns false when there is nothing to annotate yet
 * (the diver is awaiting, or the latest event is a `cleared` undo).
 */
export async function updateLatestRollCallNote(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    checkpoint: RollCallCheckpoint;
    note: string;
  },
): Promise<boolean> {
  const [latest] = await db
    .select({ id: rollCallEvents.id, status: rollCallEvents.status })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, input.shopId),
        eq(rollCallEvents.tripId, input.tripId),
        eq(rollCallEvents.bookingId, input.bookingId),
        eq(rollCallEvents.checkpoint, input.checkpoint),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    )
    .limit(1);
  if (!latest || latest.status === "cleared") return false;
  await db
    .update(rollCallEvents)
    .set({ note: input.note.trim() || null })
    .where(eq(rollCallEvents.id, latest.id));
  // The note is part of the roll-call record staff read off the offline
  // copy (src/lib/offline-manifests.ts), so an edit here is exactly the kind
  // of change the push signal exists for, same as recordRollCall above.
  await publishManifestEvent(db, input.shopId, input.tripId);
  return true;
}
