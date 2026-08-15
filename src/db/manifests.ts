import { and, asc, desc, eq, exists, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import { isStaff, STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { effectiveCrewRoles } from "@/lib/crew-roles";
import { rentalFitLine } from "@/lib/dive-prep";
import {
  type BuddyTeammate,
  buildTripManifest,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  type ManifestBuddyTeam,
  type ManifestCrewMember,
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
  rollCallCrewAttestations,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips,
} from "./schema";
import { getShopById } from "./shops";
import { getTripRoster, getTripWithBooked } from "./trips";

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
    .orderBy(desc(rollCallCrewEvents.occurredAt), desc(rollCallCrewEvents.createdAt));
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
    .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt));
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
    .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt));
  // Newest first, so the first row seen per booking is its latest event.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.bookingId)) continue;
    seen.add(row.bookingId);
    if (row.status !== "boarded") continue;
    const aboard = byTrip.get(row.tripId) ?? new Set<string>();
    aboard.add(row.bookingId);
    byTrip.set(row.tripId, aboard);
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
        .select({ occurredAt: rollCallEvents.occurredAt })
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, input.shopId),
            eq(rollCallEvents.tripId, input.tripId),
            eq(rollCallEvents.bookingId, booking.id),
            eq(rollCallEvents.checkpoint, checkpoint),
          ),
        )
        .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt))
        .limit(1);
      if (newest && newest.occurredAt > occurredAt) {
        return { ok: false, reason: "newer_event_exists" };
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
        .select({ occurredAt: rollCallCrewEvents.occurredAt })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.shopId, input.shopId),
            eq(rollCallCrewEvents.tripId, input.tripId),
            eq(rollCallCrewEvents.personId, assigned.personId),
            eq(rollCallCrewEvents.checkpoint, checkpoint),
          ),
        )
        .orderBy(desc(rollCallCrewEvents.occurredAt), desc(rollCallCrewEvents.createdAt))
        .limit(1);
      if (newest && newest.occurredAt > occurredAt) {
        return { ok: false, reason: "newer_event_exists" };
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
  return outcome;
}

export type RecordCrewAttestationOutcome =
  | { ok: true; attestationId: string; crewAboard: number; crewAssigned: number }
  | {
      ok: false;
      reason: "trip_unavailable" | "staff_not_found" | "invalid_checkpoint" | "invalid_count";
    };

/**
 * The largest crew count this accepts. Nothing DiveDay serves floats a boat
 * with more than a couple of dozen crew, and an unbounded integer typed with wet
 * hands is how a checkpoint gets "closed" by a fat-fingered 999 that nobody
 * reads as wrong.
 */
const MAX_CREW_ABOARD = 99;

/**
 * Record how many crew are aboard at one checkpoint. Append-only: every call
 * inserts a row, and the newest one is the current answer, mirroring
 * `recordRollCall`. There is no update path and no "crew ok" boolean — a head
 * count is a statement someone made at a time, not a flag.
 *
 * **No surface calls this any more** (ADR 20260804-crew-roll-call-is-per-person).
 * The manifest's typed "how many crew are aboard" control is gone, and roll-call
 * completeness reads the named crew list alone. The writer, the table, and the
 * `roll_call_crew_attestations.csv` export stay because rows already exist:
 * they are part of departures shops have sailed, the incident export renders
 * them, and the export file is a published data-portability contract. Deleting
 * it is a separate change with a migration in it, not a side effect of a UI fix.
 *
 * The **denominator is never taken from the caller**. `crewAssigned` is read
 * server-side from the trip's own assignments inside the transaction, so a
 * client cannot close a checkpoint by claiming the boat only had one crew
 * member. `crewAboard` is the only number staff supply, because it is the only
 * one that comes from looking at people.
 */
export async function recordCrewAttestation(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    attestedByPersonId: string;
    crewAboard: number;
    checkpoint?: RollCallCheckpoint;
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordCrewAttestationOutcome> {
  const outcome = await db.transaction(async (tx): Promise<RecordCrewAttestationOutcome> => {
    const checkpoint = input.checkpoint ?? "departure";
    const occurredAt = input.occurredAt ?? nowDate();
    if (
      !Number.isInteger(input.crewAboard) ||
      input.crewAboard < 0 ||
      input.crewAboard > MAX_CREW_ABOARD
    ) {
      return { ok: false, reason: "invalid_count" };
    }

    const staffId = await activeStaffRecorderId(tx, input.shopId, input.attestedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };

    // Same tenancy and trip-status gate `recordRollCall` applies before writing
    // a diver event: a trip belonging to another shop, or one already cancelled,
    // takes no head count.
    const [trip] = await tx
      .select({ id: trips.id, plannedDives: trips.plannedDives })
      .from(trips)
      .where(
        and(
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

    const crew = await listTripCrew(tx, input.shopId, input.tripId);

    const [attestation] = await tx
      .insert(rollCallCrewAttestations)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        checkpoint,
        crewAboard: input.crewAboard,
        crewAssigned: crew.length,
        attestedByPersonId: staffId,
        note: input.note?.trim() || null,
        occurredAt,
      })
      .returning({ id: rollCallCrewAttestations.id });
    if (!attestation) throw new Error("recordCrewAttestation: insert returned no row");
    return {
      ok: true,
      attestationId: attestation.id,
      crewAboard: input.crewAboard,
      crewAssigned: crew.length,
    };
  });
  // Same push signal a roll-call write raises — a crew count changes whether
  // the checkpoint reads complete on every device holding this manifest open.
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
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
    .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt))
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
