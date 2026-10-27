import { and, asc, desc, eq, exists, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import { isStaff, STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { effectiveCrewRoles, standingRatingsBesideJob } from "@/lib/crew-roles";
import { rentalFitLine } from "@/lib/dive-prep";
import { seatName } from "@/lib/held-seat";
import { log } from "@/lib/log";
import {
  type BuddyTeammate,
  boardedBefore,
  buildTripManifest,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  isTurnedAwaySeat,
  type ManifestBuddyTeam,
  type ManifestCrewMember,
  manifestAtCheckpoint,
  RETRACTION_SUPERSEDED,
  type RollCallCheckpoint,
  type RollCallRecord,
  rollCallCheckpointOrdinal,
  rollCallCheckpoints,
  rollCallNoteAllowed,
  standingResultMeansSailed,
  type TripManifest,
} from "@/lib/manifests";
import { offlineEventOutOfBounds } from "@/lib/offline-events";
import type { ParticipantType } from "@/lib/participant-types";
import { seatRefusal } from "@/lib/participant-types";
import {
  type CountedAboardBlocked,
  type ReadinessSnapshot,
  readinessSnapshotOf,
} from "@/lib/roll-call-readiness";
import { runningLateShown } from "@/lib/running-late";
import type { TrainingMarkState } from "@/lib/training-mark";
import { medicalWaiverMark } from "@/lib/waivers";
import { welcomeCueFor } from "@/lib/welcome-cue";
import { standingArrivalStatus } from "./arrival-provenance";
import { loadActiveStaffRoles } from "./authz";
import {
  boardingCertificationSnapshot,
  lockBoardingCertificationEvidence,
} from "./boarding-certification-snapshot";
import { captureDepartureBoatSafety } from "./boat-safety";
import { listTripBuddyTeams } from "./buddy-pairs";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import { listTripGearAssignments } from "./gear";
import { boundLockWaits } from "./lock-bounds";
import { publishManifestEvent } from "./manifest-events";
import { bookingsWithMedicalAlert, standingReleaseByBooking } from "./medical-alerts";
import { verifiedNitroxPersonIds } from "./nitrox";
import {
  answeringReplayAsDuplicate,
  type CLIENT_EVENT_CONFLICT,
  replayVerdict,
  type StoredOfflineEvent,
} from "./offline-replay";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { rentalFitByBooking } from "./rental-fit";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips,
} from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { getShopById } from "./shops";
import { resolveTrainingMarks } from "./training-mark-resolve";
import { crewClashes } from "./trips-crew";
import { liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";
import { getTripWithBooked } from "./trips-record";
import { getTripRoster } from "./trips-roster";
import { welcomeCueInputsByBooking } from "./welcome-cues";

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
      standingRatings: [],
      shopRoles: [],
    };
    // Null for a former staff member kept on the list by their roll-call
    // history: they hold no shop role any more, so `effectiveCrewRoles` falls
    // back to whatever job the roster recorded for them on this trip.
    if (role) crew.shopRoles.push(role);
    // The job on *this* boat when the roster says so, otherwise the standing
    // roles — one definition, src/lib/crew-roles.ts.
    crew.roles = effectiveCrewRoles({ tripRole, shopRoles: crew.shopRoles });
    // And the rating the job does not already say, beside it rather than
    // instead of it: the log and the incident export are asked what rating
    // each professional held (issue #1852).
    crew.standingRatings = standingRatingsBesideJob({ tripRole, shopRoles: crew.shopRoles });
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
  // `DbExecutor`, not `AppDb`: `undoCheckInBooking` asks this question from
  // *inside* its own transaction, where "is this diver already aboard" has to
  // be read on the same connection that holds the booking's `FOR UPDATE` row
  // (ADR 20260907-the-counter-survives-offline). A pure widening — the union
  // already contains `AppDb`, so every existing caller is unaffected.
  db: DbExecutor,
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
 * **Who the crew have counted onto the boat at any checkpoint**, by trip: the
 * bookings whose standing result at the departure checkpoint *or* at any
 * after-dive checkpoint is `boarded` (issue #2142).
 *
 * A diver picked up at the second site, or who rode out on a chase boat, is
 * first recorded `boarded` at `after_dive_1`; their dock result is empty or
 * `not_boarded`. Read from the dock alone, they were never aboard, and Today
 * dropped the "Aboard" row of a diver on a medical hold while they were in the
 * water. This is the one answer to "is this person on the boat" for that row.
 *
 * - **Newest event per checkpoint wins**, and a newest `cleared` drops that
 *   checkpoint out — the same supersession every roll-call reader here applies.
 * - **Only `boarded` counts.** An after-dive `not_boarded` is the missing-diver
 *   row's word, never "aboard"; a dock `not_boarded` is "never left".
 * - **A cancelled booking is nobody**, the guard the departure reader carries.
 *
 * One grouped query for the departures asked about, never one per booking.
 */
export async function listBoardedAtAnyCheckpointByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byTrip = new Map<string, Set<string>>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .innerJoin(
      bookings,
      and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
    )
    .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, [...tripIds])))
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  // Newest first, so the first row per booking and checkpoint is that
  // checkpoint's standing result.
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.bookingId}\u0000${row.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.status !== "boarded") continue;
    const aboard = byTrip.get(row.tripId) ?? new Set<string>();
    aboard.add(row.bookingId);
    byTrip.set(row.tripId, aboard);
  }
  return byTrip;
}

/**
 * **Every seat the crew have spoken for at an after-dive checkpoint**, by trip.
 *
 * The departure reader above is pinned to the dock on purpose, and its docblock
 * says why: at the dock `not_boarded` means "never left" and is benign. This is
 * the other half of the same evidence, kept as its own function so that neither
 * word can be read through the wrong one. A booking is in the set when the
 * newest result standing at **any** after-dive checkpoint is `boarded` or
 * `not_boarded` — either way, that person was on the boat. A `cleared` newest
 * drops the checkpoint out, the same supersession every reader here applies.
 *
 * **Two callers, and they are why it exists** (dive-domain-expert review, issue
 * #1704). `seatSailed` (src/lib/closeout.ts) ranked the dock alone, so the
 * evening said "0 out, 0 back" about a one-diver boat carrying a missing diver:
 * the desk's `no_show` stood, no dock result contradicted it, and the after-dive
 * `not_boarded` the day was raising a top-severity row about was invisible to
 * the count. And the counter's own door (then a Check-in tab of its own) drew
 * "Did not dive?" over exactly those divers, because it fed `noShowGate` the
 * departure-boarded set — the writer refused the tap, so no seat was ever lost,
 * but the app spent two taps inviting the desk to write off the person the crew
 * were looking for.
 *
 * One grouped query for the whole day, never one per boat.
 */
export async function listAfterDiveRollCallByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Map<string, "boarded" | "missing_after_dive">>> {
  const byTrip = new Map<string, Map<string, "boarded" | "missing_after_dive">>();
  // A `boarded` anywhere outranks a `missing_after_dive`, the same precedence
  // `onTheWaterByRollCall` applies: the crew counted this person back onto the
  // boat.
  for (const row of await standingAfterDiveResults(db, shopId, tripIds)) {
    const spoken = byTrip.get(row.tripId) ?? new Map<string, "boarded" | "missing_after_dive">();
    if (row.status === "boarded") spoken.set(row.bookingId, "boarded");
    else if (!spoken.has(row.bookingId)) spoken.set(row.bookingId, "missing_after_dive");
    byTrip.set(row.tripId, spoken);
  }
  return byTrip;
}

/**
 * Each booking's **standing result at each after-dive checkpoint** of the trips
 * asked about: newest event per booking and checkpoint wins, a newest `cleared`
 * drops that checkpoint out, and a cancelled booking is nobody. The one diver
 * query behind `listAfterDiveRollCallByTrip`.
 */
async function standingAfterDiveResults(db: DbExecutor, shopId: string, tripIds: string[]) {
  if (tripIds.length === 0) return [];
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
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
        ne(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  // Newest first, so the first row seen per booking *and* checkpoint is that
  // checkpoint's standing result.
  const seen = new Set<string>();
  const standing: { tripId: string; bookingId: string; status: "boarded" | "not_boarded" }[] = [];
  for (const row of rows) {
    const key = `${row.bookingId}:${row.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!standingResultMeansSailed(row.checkpoint, row.status)) continue;
    if (row.status === "cleared") continue;
    standing.push({ tripId: row.tripId, bookingId: row.bookingId, status: row.status });
  }
  return standing;
}

/**
 * **The seats the crew have recorded not back aboard and not counted since**,
 * by trip (issue #2404): the divers a departure page must not call finished.
 *
 * A seat is in the set when its newest word at some after-dive checkpoint is
 * `not_boarded` ("did not come back") and no later after-dive checkpoint has
 * its newest word `boarded`. The latest checkpoint speaks, the rule
 * `homewardCheckpointGap` and Today's missing-diver row (`listRollCallGaps`,
 * `src/db/today.ts`) keep too: a diver missing after dive 1 and counted aboard
 * after dive 2 is back, and one missing after dive 1 whom nobody has counted
 * since is still not.
 *
 * - **Newest event per seat and checkpoint wins, and a newest `cleared` drops
 *   that checkpoint out**, so a mis-tapped "not back" the crew retracted, or a
 *   correction to `boarded`, leaves nobody here. The same supersession every
 *   roll-call reader in this file applies.
 * - **The dock is never read.** A `not_boarded` there means "never left"
 *   (`standingResultMeansSailed`), benign, and never carried forward as
 *   missing.
 * - **A cancelled booking is nobody**, the guard the siblings carry.
 * - **Divers only.** Missing crew is the crew roll call's
 *   (`listDepartureCrewRollCallByTrip`) and still raises its own row.
 *
 * One grouped query for the trips asked about, never one per seat.
 */
export async function listUnaccountedForByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const byTrip = new Map<string, Set<string>>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
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
        inArray(rollCallEvents.tripId, [...tripIds]),
        ne(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  // Newest first, so the first row seen per seat and checkpoint is that
  // checkpoint's standing result; a `cleared` newest drops it out.
  const seen = new Set<string>();
  const latest = new Map<string, { tripId: string; missing: number; back: number }>();
  for (const row of rows) {
    const key = `${row.bookingId}\u0000${row.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The query already dropped the departure checkpoint; anything that is not
    // an after-dive one has no ordinal and is not read.
    if (row.status === "cleared" || !row.checkpoint.startsWith("after_dive_")) continue;
    const ordinal = rollCallCheckpointOrdinal(row.checkpoint as RollCallCheckpoint);
    if (!Number.isFinite(ordinal)) continue;
    const seat = latest.get(row.bookingId) ?? { tripId: row.tripId, missing: 0, back: 0 };
    if (row.status === "not_boarded") seat.missing = Math.max(seat.missing, ordinal);
    else seat.back = Math.max(seat.back, ordinal);
    latest.set(row.bookingId, seat);
  }
  for (const [bookingId, seat] of latest) {
    if (seat.missing <= seat.back) continue;
    const unaccounted = byTrip.get(seat.tripId) ?? new Set<string>();
    unaccounted.add(bookingId);
    byTrip.set(seat.tripId, unaccounted);
  }
  return byTrip;
}

/**
 * **The seats counted aboard while blocked**, per departure and booking, for a
 * finished departure's record (issue #2414): "Sailed · counted aboard at after
 * dive 1 while blocked: no certification on file".
 *
 * Read off the snapshot each `boarded` event keeps (`readiness_status`), never
 * recomputed: readiness today says nothing about readiness at the rail. A
 * record, not a gate; nothing refuses or allows anything on it.
 *
 * - **Only a standing word counts.** The newest event per seat and checkpoint
 *   wins, so a count the crew corrected to `not_boarded` or retracted
 *   (`cleared`) leaves nothing here, the supersession every roll-call reader
 *   applies.
 * - **The earliest checkpoint a seat was counted blocked at** is the one said,
 *   in checkpoint order, so the line names where the trouble started.
 * - **A cancelled booking is nobody.**
 *
 * One grouped query for the trips asked about.
 */
export async function listCountedAboardBlockedByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, Map<string, CountedAboardBlocked>>> {
  const byTrip = new Map<string, Map<string, CountedAboardBlocked>>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      readinessStatus: rollCallEvents.readinessStatus,
      readinessBlockers: rollCallEvents.readinessBlockers,
    })
    .from(rollCallEvents)
    .innerJoin(
      bookings,
      and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
    )
    .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, [...tripIds])))
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const seen = new Set<string>();
  const earliest = new Map<
    string,
    { ordinal: number; tripId: string; blocked: CountedAboardBlocked }
  >();
  for (const row of rows) {
    const key = `${row.bookingId}\u0000${row.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.status !== "boarded" || row.readinessStatus !== "blocked") continue;
    const ordinal = rollCallCheckpointOrdinal(row.checkpoint as RollCallCheckpoint);
    const held = earliest.get(row.bookingId);
    if (held && held.ordinal <= ordinal) continue;
    earliest.set(row.bookingId, {
      ordinal,
      tripId: row.tripId,
      blocked: { checkpoint: row.checkpoint, blockers: row.readinessBlockers ?? [] },
    });
  }
  for (const [bookingId, { tripId, blocked }] of earliest) {
    const seats = byTrip.get(tripId) ?? new Map<string, CountedAboardBlocked>();
    seats.set(bookingId, blocked);
    byTrip.set(tripId, seats);
  }
  return byTrip;
}

/**
 * **One seat's own departure result**, for the diver's own page rather than a
 * staff roster: `boarded`, `not_boarded`, or null where the crew recorded
 * nothing at all.
 *
 * It exists because the thread's after-state must never assert that somebody
 * dived on the strength of a clock (`isAfterTheDive`, src/lib/thread-steps.ts).
 * A departure roll call is the only direct evidence DiveDay holds about who
 * actually got on the boat, and this is the narrowest possible read of it —
 * one booking, and only the answer, never the recorder, the note or the `seq`.
 *
 * Composed from the trip reader above rather than a second query, so the two
 * cannot drift about what "the latest result" means — including its
 * `cleared`-drops-out rule and its cancelled-booking guard.
 */
export async function departureRollCallForBooking(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<"boarded" | "not_boarded" | null> {
  const byTrip = await listDepartureRollCallByTrip(db, shopId, [tripId]);
  return byTrip.get(tripId)?.get(bookingId) ?? null;
}

/**
 * **Does the crew's own roll call put this diver on the water?** True on either
 * of the two statements a crew can make that mean the diver went to sea:
 *
 * - `boarded` standing at **any** checkpoint — the dock, or a later after-dive
 *   head count. A diver who joined at the second site has no departure event at
 *   all.
 * - `not_boarded` standing at an **after-dive** checkpoint, which is not "never
 *   came" but **did not come back from the dive**. That is the missing-diver
 *   row, and the diver it is about sailed (`docs/product/glossary.md`,
 *   **sailed**).
 *
 * **A `departure` `not_boarded` is deliberately not read, and that asymmetry is
 * the whole of this function.** At the dock the same word means "never left the
 * dock": the benign half, and the ordinary absence the counter exists to let a
 * shop record. Reading it here would make every walk-away permanently
 * un-markable, which is the failure direction that stops a shop doing its work
 * rather than the one that endangers a diver. The rule is the one
 * `src/db/today.ts` already writes down at `isAccountedForAfterDive` and
 * `inAfterDivePopulation` (DOM-H3), consumed rather than restated: exactly the
 * population that reader counts as at risk in the water is the population the
 * desk may not call absent.
 *
 * **Persisted rows only, never `carryForwardNotBoarded`.** `implied` is never
 * stored (see {@link standingDiverRollCall}), so a `not_boarded` row at an
 * after-dive checkpoint is always an explicit "did not come back". Running the
 * results through that helper first would carry the dock's `not_boarded` onto
 * every later checkpoint and refuse the mark for the exact case it must allow.
 *
 * The counter's own refusal (`noShowGate`, src/lib/no-show.ts) asked
 * {@link departureRollCallForBooking} for one slice, which is pinned to the
 * dock and so said nothing at all about either half above. Neither has a
 * departure `boarded`, so "nobody has boarded them" read true and the desk
 * could take a body already in the water off the expected list — well inside
 * the counter's six-hour reach, which covers a whole two-tank morning.
 *
 * **Both halves of the head count.** The diver table answers for the seat; the
 * crew table answers for a staffer who holds a seat on a trip they also crew,
 * which a shop where staff dive too has on most boats. Missing crew outranks a
 * missing diver on this product's own severity ranking, so a reader that saw
 * only `roll_call_events` was unsafe in the narrow case and the review that
 * found it said so (issue #1704). The crew read is a second query on the rare
 * branch rather than a union, because the ordinary seat belongs to somebody who
 * is not on the roster at all.
 *
 * Grouped here rather than in SQL: per checkpoint the newest event wins and a
 * `cleared` newest drops out, the same supersession every other reader in this
 * file applies. The cancelled-booking guard is the sibling's too, for the
 * sibling's reason — a seat given up is refused as `not_booked`, never as a
 * boarding.
 */
export async function onTheWaterByRollCall(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<OnTheWater> {
  const rows = await db
    .select({ checkpoint: rollCallEvents.checkpoint, status: rollCallEvents.status })
    .from(rollCallEvents)
    .innerJoin(
      bookings,
      and(eq(bookings.id, rollCallEvents.bookingId), ne(bookings.status, "cancelled")),
    )
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        eq(rollCallEvents.bookingId, bookingId),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const fromDivers = standingRowMeansSailed(rows);
  if (fromDivers) return fromDivers;

  // **The crew roll call, for a staffer who holds a seat on a trip they crew.**
  // "Missing crew" is severity 2 on this product's own ranking, above a missing
  // diver, on the grounds that the crew are the people most reliably in the
  // water (`docs/product/glossary.md`). Their results live in a different table
  // keyed on the person rather than the booking, so without this read a shop
  // where staff dive too could mark absent the one seat belonging to somebody
  // the crew half of the head count says never came back — seat released, dive
  // day struck, and the two halves of souls-on-board disagreeing about a human
  // (dive-domain-expert review, issue #1704).
  //
  // Second query rather than a union, and only when the diver table said
  // nothing: the ordinary seat belongs to somebody who is not on the roster, so
  // the common path pays for one read and this one is the rare branch. The
  // `tripAssignments` join is the crew counterpart of the cancelled-booking
  // guard above — somebody taken off the roster keeps their event rows and must
  // not answer for a crew list they are no longer on.
  const crewRows = await db
    .select({ checkpoint: rollCallCrewEvents.checkpoint, status: rollCallCrewEvents.status })
    .from(rollCallCrewEvents)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, bookingId),
        eq(bookings.personId, rollCallCrewEvents.personId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .innerJoin(
      tripAssignments,
      and(
        eq(tripAssignments.tripId, rollCallCrewEvents.tripId),
        eq(tripAssignments.personId, rollCallCrewEvents.personId),
      ),
    )
    .where(and(eq(rollCallCrewEvents.shopId, shopId), eq(rollCallCrewEvents.tripId, tripId)))
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    );
  return standingRowMeansSailed(crewRows);
}

/**
 * **Which of the two statements put this person at sea**, or null for neither.
 *
 * A boolean was enough while the counter's refusal said the same sentence for
 * both, and a dive-domain-expert review said that sentence was the wrong shape:
 * "the boat's roll call puts that diver on the water, check the manifest" is a
 * rule citation, and for `missing_after_dive` the fact the staffer needs is
 * that a human has recorded that this diver did not come back from a dive —
 * which changes what they do in the next sixty seconds rather than only where
 * they tap (issue #1704).
 *
 * `boarded` wins where both stand: a diver counted back onto the boat at a
 * later checkpoint is aboard, and only the newest word per checkpoint is read
 * at all, so a `missing_after_dive` here is one nothing has retracted.
 */
export type OnTheWater = "boarded" | "missing_after_dive" | null;

/**
 * Newest-first rows, grouped to one standing result per checkpoint, asked
 * {@link standingResultMeansSailed}. The first row seen for a checkpoint is
 * that checkpoint's standing result; a `cleared` newest answers false, so the
 * checkpoint drops out entirely rather than falling back to an older row.
 *
 * Walked to the end rather than returned on the first hit, because a
 * `boarded` anywhere outranks a `missing_after_dive`: the crew counted this
 * person back, and the checkpoints do not arrive in order here.
 */
function standingRowMeansSailed(
  rows: readonly { checkpoint: string; status: "boarded" | "not_boarded" | "cleared" }[],
): OnTheWater {
  const seen = new Set<string>();
  let missing = false;
  for (const row of rows) {
    if (seen.has(row.checkpoint)) continue;
    seen.add(row.checkpoint);
    if (!standingResultMeansSailed(row.checkpoint, row.status)) continue;
    if (row.status === "boarded") return "boarded";
    missing = true;
  }
  return missing ? "missing_after_dive" : null;
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
 * **The departures whose dock roll call was taken at all**: any departure
 * checkpoint event recording a result (`boarded` or `not_boarded`), whatever
 * has happened to its booking since and whatever later undid it.
 *
 * Deliberately **not** the cancelled-booking-guarded readers above: they
 * answer who is aboard, and a seat cancelled after it was boarded is nobody.
 * This answers whether the crew stood at the dock and counted, which that
 * cancel does not unsay. A finished departure's record reads it (UX review
 * 2026-10-10, item 10), so a boat whose whole roster stayed ashore, or whose
 * boarded seats were cancelled, never reads "No roll call taken".
 */
export async function departureRollCallTakenTripIds(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ tripId: rollCallEvents.tripId })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        inArray(rollCallEvents.tripId, [...tripIds]),
        eq(rollCallEvents.checkpoint, "departure"),
        inArray(rollCallEvents.status, ["boarded", "not_boarded"]),
      ),
    );
  return new Set(rows.map((row) => row.tripId));
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
/** A standing training mark as the manifest prints it; null for none, or one that no longer stands. */
function trainingDiveOf(
  mark: TrainingMarkState | undefined,
  identityHeld: boolean,
  siteAttributionUnknown: boolean,
): TripManifest["divers"][number]["trainingDive"] {
  // Aboard means the course's own instructor (issue #2731), the same answer
  // readiness reads to take the course's level.
  return mark?.valid && !identityHeld
    ? {
        courseTitle: mark.enrollmentCourseTitle,
        ...(mark.enrollmentCourse ? { intro: mark.enrollmentCourse.intro } : {}),
        instructorAboard: mark.courseInstructorAboard,
        overRatio: mark.overRatio ?? false,
        ...(siteAttributionUnknown ? { siteAttributionUnknown: true } : {}),
      }
    : null;
}

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
    gearByBooking,
    crew,
    crewRollCalls,
    buddyTeams,
    standingClashes,
    welcomeInputs,
    ...rollCalls
  ] = await Promise.all([
    getShopById(db, shopId),
    getTripRoster(db, shopId, tripId),
    listTripReadiness(db, shopId, tripId),
    verifiedNitroxPersonIds(db, shopId),
    rentalFitByBooking(db, shopId, tripId),
    // The units each booking holds on the register, so a piece it already
    // holds is not marked "no longer rented" on the rail (issue #1811). The
    // same read the Gear tab's prep list hands the same rule.
    listTripGearAssignments(db, shopId, tripId),
    listTripCrew(db, shopId, tripId),
    listLatestCrewRollCalls(db, shopId, tripId),
    listTripBuddyTeams(db, shopId, tripId),
    // Who on this crew is also on another departure these hours overlap. Read
    // here rather than on the page so the offline snapshot and every other
    // consumer of a manifest carry the same fact (issue #1779). It answers
    // nothing for a departure that has come home, which is the rule the week
    // grid already keeps.
    crewClashes(db, shopId, tripId),
    // The two facts behind the welcome word (issue #1182): who consented, and
    // when this shop last had them on a boat. Read here rather than in the page
    // so the offline serializer and every other consumer of a manifest see the
    // same derived cue.
    welcomeCueInputsByBooking(db, shopId, tripId),
    ...checkpoints.map((checkpoint) => listLatestRollCallByBooking(db, shopId, tripId, checkpoint)),
  ]);
  if (!shop) return null;
  // The fact of a medical alert for the crew on each seat's standing release
  // (issue #2960), never its text: every staffer who opens this manifest sees
  // that one exists. Held seats are left out by `standingReleaseByBooking`.
  const alertedBookings = await bookingsWithMedicalAlert(
    db,
    shopId,
    standingReleaseByBooking(readinessRows),
  );
  const readinessByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.readiness] as const),
  );
  const trainingAttributionByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.trainingSiteAttributionUnknown] as const),
  );
  const depthByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.depthAdvisory] as const),
  );
  // When/how each diver's medical currency was last established, for spotting a
  // stale medical. Digital and staff-attested paper reviews both resolve here;
  // a pending/in-review record resolves to null.
  // The mark carries `overriddenReferralAt` (issue #1282) and
  // `overriddenRefusal` (issue #2158), which one record alone cannot answer —
  // so the two `getTripReadiness` already derived from the diver's whole signed
  // history are put back onto it here rather than derived a second time from a
  // single row.
  const medicalByBooking = new Map(
    readinessRows.map((row) => {
      const mark = medicalWaiverMark(row.waiver);
      return [
        row.booking.id,
        mark
          ? {
              ...mark,
              overriddenReferralAt: row.overriddenReferralAt,
              overriddenReferral: row.overriddenReferral,
              overriddenRefusal: row.overriddenRefusal,
            }
          : null,
      ] as const;
    }),
  );
  const riderHoldByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.riderMedicalHold] as const),
  );
  // Who cleared a training mark while its course forms were still owed (issue
  // #2275): that clear relaxed a boarding block, so the crew sees who did it.
  // Read only when such a seat is aboard.
  const clearedByIds = [
    ...new Set(
      roster
        .map(({ booking }) => booking.trainingClearedByPersonId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const clearedByName = new Map(
    clearedByIds.length === 0
      ? []
      : (
          await db
            .select({ id: people.id, name: people.fullName })
            .from(people)
            // diveday:allow-deleted-people: who cleared the mark, kept as history.
            .where(and(eq(people.shopId, shopId), inArray(people.id, clearedByIds)))
        ).map((row) => [row.id, row.name] as const),
  );
  // The training marks that stand on this departure (issue #2275), through the
  // one resolver every reader shares, and whether the course's instructor is on
  // its crew now: the manifest names the course a dive counts toward and warns
  // when nobody aboard teaches it. Read only when a marked seat is aboard.
  const trainingMarks = await resolveTrainingMarks(
    db,
    shopId,
    roster.flatMap(({ booking, person }) =>
      booking.trainingEnrollmentBookingId === null
        ? []
        : [
            {
              bookingId: booking.id,
              tripId: trip.id,
              enrollmentBookingId: booking.trainingEnrollmentBookingId,
              seat: {
                personId: person.id,
                participantType: booking.participantType as ParticipantType,
                onCourseSession: trip.courseId !== null,
                departureStartsAt: trip.startsAt,
              },
            },
          ],
    ),
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
  // One entry per (person, other departure) already, so this only groups.
  const clashesByCrewId = new Map<string, { tripId: string; title: string }[]>();
  for (const clash of standingClashes) {
    clashesByCrewId.set(clash.personId, [
      ...(clashesByCrewId.get(clash.personId) ?? []),
      { tripId: clash.otherTripId, title: clash.otherTitle },
    ]);
  }
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
    // The seats this boat sells, carried so the manifest can say when the head
    // count has passed them (`summary.overCapacity`). Nothing on the boarding
    // path refuses, so this is the only place the boat being over gets said.
    // Capped at the boat's certificate (#2321): over the certificate is over.
    capacity: trip.sellableCapacity,
    // The certificate itself, so the head count can say when the people the
    // crew counted aboard pass it (batch 6, item 2).
    certifiedPassengers: trip.certifiedPassengers,
    certifiedTotalPersons: trip.certifiedTotalPersons,
    // Printed beside souls on board, so a practice sheet is never read as a boat.
    isRehearsal: trip.isRehearsal,
    exceedsNoDecoLimits: trip.exceedsNoDecoLimits,
    // The dock-rider form stays shut on a cancelled departure (#2394).
    cancelled: trip.status === "cancelled",
  };
  const diverInputs = roster.map(({ booking, person }) => {
    return {
      bookingId: booking.id,
      // A held seat is named as booked here, once, so the alarm, the buddy
      // builder and every copy downstream inherit it (issue #1690).
      fullName: seatName(person.fullName, booking),
      // Diver, snorkeler or rider — shown on the row, never used to drop it.
      participantType: booking.participantType,
      bookedAs: booking.bookedAs,
      email: person.email,
      emergencyContactName: person.emergencyContactName,
      emergencyContactPhone: person.emergencyContactPhone,
      medicalAlert: alertedBookings.has(booking.id),
      readiness: readinessByBooking.get(booking.id),
      identityClaim: booking.identityUnconfirmedAt
        ? {
            bookedAs: booking.identityBookedAs,
            matchedBy: booking.identityMatchedBy,
            // The desk's contact for the person on the seat (issue #2145),
            // shown in place of the matched record's, which is withheld.
            heldEmergencyContact:
              booking.heldEmergencyContactName && booking.heldEmergencyContactPhone
                ? {
                    name: booking.heldEmergencyContactName,
                    phone: booking.heldEmergencyContactPhone,
                  }
                : null,
          }
        : undefined,
      // The shop's own catalog. Without it the rail and the offline snapshot
      // read a dropped piece as an ordinary piece to fetch, and size a
      // drysuit diver's fins up over a boot that is not coming (issue #1804).
      // A snorkeler's line names surface kit only (ADR 20261007-participant-types).
      rentalFit: rentalFitLine(
        fitByBooking.get(booking.id) ?? null,
        shop.rentalItems,
        booking.participantType,
        (gearByBooking.get(booking.id) ?? []).map((assignment) => assignment.kind),
      ),
      nitroxRequested: booking.wantsNitrox && certified.has(person.id),
      medicalWaiver: medicalByBooking.get(booking.id) ?? null,
      riderMedicalHold: riderHoldByBooking.get(booking.id) ?? null,
      trainingDive: trainingDiveOf(
        trainingMarks.get(booking.id),
        booking.identityUnconfirmedAt !== null,
        trainingAttributionByBooking.get(booking.id) ?? true,
      ),
      trainingMarkCleared: booking.trainingClearedAt
        ? {
            reason: booking.trainingClearedReason ?? "forms_owed",
            byName: booking.trainingClearedByPersonId
              ? (clearedByName.get(booking.trainingClearedByPersonId) ?? null)
              : null,
          }
        : null,
      // Null whenever the shop holds no date of birth, so the captain's list
      // stays quiet rather than showing "unknown" down the whole boat.
      age: person.dateOfBirth ? ageOnDate(person.dateOfBirth, tripDate) : null,
      // A date of birth decides; with none, the seat's "Under 18" stamp does,
      // the same rule as the roster's Minor badge (roster-seat.ts).
      minor: person.dateOfBirth
        ? isMinorOnDate(person.dateOfBirth, tripDate)
        : Boolean(booking.minorDeclaredAt),
      birthday: birthdayCallout(person.dateOfBirth, tripDate),
      // Null unless the diver said so, and null again an hour after this boat
      // is home — the whole expiry lives in `welcomeCueFor`, so nothing here
      // has to remember to stop rendering it.
      welcomeCue: welcomeCueFor({
        ...(welcomeInputs.get(booking.id) ?? {
          sharedAt: null,
          lastDivedAt: null,
          nonDiver: false,
          diveDayCount: null,
        }),
        tripEndsAt: trip.endsAt,
      }),
      depthAdvisory: depthByBooking.get(booking.id),
      // Said whether or not the shop still offers hotel pickups (the Features
      // page): switching the offer off stops new ones, and a diver already
      // promised a pickup is still collected.
      hotelPickupLocation: booking.hotelPickupLocation,
      pickupTime: booking.pickupTime,
      // The lunch note (item 56): where the crew actually look, as well as
      // Prep. A meal preference for the galley, never an allergy record.
      dietaryNote: booking.dietaryNote,
      // The diver's own "running late" (#2319), cleared from an arrived or
      // released seat the way the arrivals list clears it.
      runningLateAt: runningLateShown({
        bookingStatus: booking.status,
        runningLateAt: booking.runningLateAt,
      }),
      checkedIn: booking.status === "checked_in",
      // The other half of the same column, and the one the roster read could
      // not say before there was a writer for it (#1209): this seat was
      // released at the desk. The row stays — `getTripRoster` keeps every
      // non-cancelled booking on purpose — and now says so.
      notHere: booking.status === "no_show",
      // Seen at the desk and refused (H-135), which the row says apart from a
      // diver who never came.
      turnedAway: isTurnedAwaySeat(booking),
      // The category only (H-135); the departure log prints it on the seat's
      // "turned away" line (#2907).
      turnedAwayReason: booking.status === "no_show" ? booking.turnedAwayReason : null,
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
        clashes: clashesByCrewId.get(member.id) ?? [],
      })),
      divers: diverInputs.map((diver) => ({
        ...diver,
        rollCall: effectiveByBooking.get(diver.bookingId)?.[index],
        boardedEarlier: boardedBefore(
          (effectiveByBooking.get(diver.bookingId) ?? []).slice(0, index),
        ),
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
  return manifests ? manifestAtCheckpoint(manifests, checkpoint) : null;
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
        /**
         * Boarded at departure on a seat the desk turned away and has since
         * sold: taking it back would put the boat over its capacity (layer 3
         * re-review, dde-3 #6). After-dive head counts are never refused.
         */
        | "boat_full"
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
        | typeof CLIENT_EVENT_CONFLICT
        | "snapshot_invalid";
    };

/**
 * The newest roll-call result standing at one subject and checkpoint, as the
 * state alone. Read only when a note accompanies a `boarded` or `cleared`
 * event — the one case `rollCallNoteAllowed` cannot settle from the payload —
 * so an ordinary roll call still costs exactly one insert.
 *
 * `implied` is never stored: carry-forward is derived at read time
 * (`carryForwardNotBoarded`), so a persisted `not_boarded` at an after-dive
 * checkpoint is always an explicit "did not come back". A `cleared` newest is
 * returned as *nothing standing*, which is what it means.
 */
async function standingDiverRollCall(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  keys: { shopId: string; tripId: string; bookingId: string; checkpoint: string },
): Promise<Pick<RollCallRecord, "state"> | undefined> {
  const [newest] = await tx
    .select({ status: rollCallEvents.status })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, keys.shopId),
        eq(rollCallEvents.tripId, keys.tripId),
        eq(rollCallEvents.bookingId, keys.bookingId),
        eq(rollCallEvents.checkpoint, keys.checkpoint),
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    )
    .limit(1);
  return newest && newest.status !== "cleared" ? { state: newest.status } : undefined;
}

/** The crew half of {@link standingDiverRollCall}. */
async function standingCrewRollCall(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  keys: { shopId: string; tripId: string; personId: string; checkpoint: string },
): Promise<Pick<RollCallRecord, "state"> | undefined> {
  const [newest] = await tx
    .select({ status: rollCallCrewEvents.status })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.shopId, keys.shopId),
        eq(rollCallCrewEvents.tripId, keys.tripId),
        eq(rollCallCrewEvents.personId, keys.personId),
        eq(rollCallCrewEvents.checkpoint, keys.checkpoint),
      ),
    )
    .orderBy(
      desc(rollCallCrewEvents.occurredAt),
      desc(rollCallCrewEvents.createdAt),
      desc(rollCallCrewEvents.seq),
    )
    .limit(1);
  return newest && newest.status !== "cleared" ? { state: newest.status } : undefined;
}

/**
 * The note this event may carry, after the domain rule. A typed sentence that
 * the rule refuses is **dropped, not written** — every surface that offers the
 * box already restricts it to the acts that take one, so anything else is a
 * hand-crafted post at the append-only safety trail.
 */
async function acceptedRollCallNote(
  note: string | null | undefined,
  checkpoint: RollCallCheckpoint,
  status: "boarded" | "not_boarded" | "cleared",
  standing: () => Promise<Pick<RollCallRecord, "state"> | undefined>,
): Promise<string | null> {
  const typed = note?.trim();
  if (!typed) return null;
  // Raising the alarm needs no read; only a retraction depends on what stands.
  const current = status === "not_boarded" ? undefined : await standing();
  return rollCallNoteAllowed(checkpoint, status, current) ? typed : null;
}

/**
 * **The crew boarded somebody the counter had written off, so the seat is
 * theirs again.**
 *
 * `markBookingNoShow` (src/db/no-show.ts) releases a seat the instant a staffer
 * confirms the diver did not come: `no_show` leaves `SEAT_HELD_STATUSES`, the
 * boat reads one seat lighter, and a walk-in can buy it. Readiness never reads
 * booking status and `getTripRoster` drops only cancelled rows, so that released
 * seat stayed boardable and the crew were looking straight at a tappable name
 * (security and dive-domain review 20260911). Boarded plus sold is the boat
 * carrying capacity plus one, with both names on the manifest.
 *
 * **The rail does not refuse it.** The gate above already argues that refusing
 * to record a body on the boat corrupts the one number that says nobody was
 * left in the water, and a crew member tapping Boarded is the strongest
 * evidence this product holds about where a person is. So this write is the
 * *consequence* of the tap, never a gate in front of it: the diver goes back on
 * the expected list and the seat count goes back to counting them.
 *
 * **No capacity check, deliberately.** If the walk-in already holds the seat
 * the boat is over, and saying so is the manifest's job
 * (`summary.overCapacity`, src/lib/manifests.ts) — refusing here would leave a
 * person aboard whom the manifest does not carry, which is the worse of the two
 * states by a distance.
 *
 * **Two halves of the head count reach here, not one.** `recordRollCall`
 * calls it for the diver trail and `recordCrewRollCall` for the crew trail,
 * because `onTheWaterByRollCall` refuses the desk from *both* and a mirror act
 * that reads only one leaves the desk-first ordering open on the other. The
 * crew half is not the exotic case: a staffer's own seat is the one readiness
 * refuses at the dock, so their crew-list result is often the only boarding
 * that can be written about them (issue #1686).
 *
 * **Two statements reach here, not one.** A boarding at any checkpoint, and a
 * `not_boarded` at an **after-dive** checkpoint — which does not mean "never
 * came" but "did not come back from the dive", and is therefore a diver who
 * sailed and is now the one the day is looking for. Both are the crew saying
 * the diver went to sea, so both take the release back; `missingAfterDive`
 * only picks which trail line says so. The caller applies
 * `standingResultMeansSailed`, so this and `noShowGate`'s refusal cannot
 * disagree about a diver (issue #1704).
 *
 * **One direction only.** A **departure** `not_boarded`, or a `cleared`, does
 * not release the seat again. Releasing a seat is the desk's act, with its own
 * gate and its own confirm tap (`noShowGate`), and a mis-tap at the rail must
 * never sell a diver's seat out from under them.
 */
async function reclaimReleasedSeat(
  tx: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    personId: string;
    recordedByPersonId: string;
    occurredAt: Date;
    /** The crew reported them not back aboard, rather than boarding them. */
    missingAfterDive: boolean;
  },
): Promise<void> {
  // The seat comes back as what it was, exactly as `undoBookingNoShow` puts it
  // back (src/db/no-show.ts): `checked_in` when the arrival trail still says
  // the desk saw the diver, `booked` otherwise. Restoring `booked` every time
  // put a diver the counter had already checked in back on its "still to
  // come" list (issue #1838). Both hold a seat (`SEAT_HELD_STATUSES`).
  const standing = await standingArrivalStatus(tx, input.shopId, input.tripId, input.bookingId);
  const [updated] = await tx
    .update(bookings)
    // A seat back on the boat is not turned away (`bookings_turned_away_is_released`).
    .set({
      status: standing === "arrived" ? "checked_in" : "booked",
      turnedAwayReason: null,
      turnedAwayAt: null,
    })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.status, "no_show")))
    .returning({ id: bookings.id });
  if (!updated) return;

  // Both names in one read, and only on this rare branch — a roll-call tap must
  // not pay for the trail of the case it almost never hits.
  const named = await tx
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    // diveday:allow-deleted-people: names for the trail line about this seat.
    .where(
      and(
        eq(people.shopId, input.shopId),
        inArray(people.id, [input.recordedByPersonId, input.personId]),
      ),
    );
  const names = new Map(named.map((row) => [row.id, row.fullName] as const));
  const actor = names.get(input.recordedByPersonId);
  const diver = names.get(input.personId);
  // Neither can be missing: the recorder was proven this shop's live staff a
  // few lines ago and the diver holds the booking. If one ever is, the seat
  // still comes back and the gap is reported — a trail line the product cannot
  // word is not worth refusing a boarding over.
  if (!actor || !diver) {
    log("manifest.seat_reclaim_unnamed", "error", { bookingId: input.bookingId });
    return;
  }
  await tx.insert(activityEvents).values({
    shopId: input.shopId,
    tripId: input.tripId,
    bookingId: input.bookingId,
    actorPersonId: input.recordedByPersonId,
    code: input.missingAfterDive ? "booking_no_show_missing_after_dive" : "booking_no_show_boarded",
    params: { actor, diver },
    occurredAt: input.occurredAt,
  });
}

/**
 * **A "not back aboard" after a dive stops the automatic recap for the whole
 * departure** (domain review of #2123), in the same transaction as the word.
 * The recap page and the email already wait while the word stands; this is for
 * after it is corrected. A person counted back an hour later may still have
 * been an incident, and "welcome back" is not the cron's call to make then —
 * a staffer releases it from the close-out. Never written at the dock, where
 * `not_boarded` means "never left" (`src/lib/roll-call.ts`).
 */
async function pauseRecapOnMissingAfterDive(
  tx: AppTransaction,
  input: { shopId: string; tripId: string; status: string; checkpoint: RollCallCheckpoint },
) {
  if (input.status !== "not_boarded" || input.checkpoint === "departure") return;
  await tx
    .update(trips)
    .set({ recapAutoSendPaused: true })
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)));
}

/**
 * Roll call is append-only operational history. At departure, a boarded event
 * has an additional hard gate: the shared readiness service must prove the diver
 * ready at the moment staff board them. After-dive checkpoints are a physical
 * head count of who is on the boat — a diver whose paperwork lapsed after the
 * boat left is still aboard and must be recordable as present.
 *
 * A boarded event on a seat the counter released takes that release back
 * (`reclaimReleasedSeat`). The rail never refuses; it overrules.
 */
/**
 * **Roll call never refuses a boat that is already counting heads**
 * (dive-domain review, 2026-10-09). A trip takes roll-call writes while it is
 * scheduled, and — whatever its status — once anybody, diver or crew, has a
 * roll-call event on it: a departure cancelled after the count began (a plain
 * cancel at the dock, a status flipped by mistake) must still be able to say
 * who is aboard and who came back. The blow-out refuses such a trip outright
 * (`setUpTripBlowout`); this is the other side of the same rule. The id is
 * bound as a value so the subqueries cannot match another trip's rows.
 *
 * An offline tap made before the cancel (`offlineOccurredAt` earlier than
 * `cancelled_at`) is taken too: the crew counted with no signal while the
 * departure was still on, and its sync must not lose that count (records
 * review 8). A live write, or an offline one made after the cancel, is not.
 */
function scheduledOrCountingHeads(tripId: string, offlineOccurredAt: Date | null = null) {
  return or(
    eq(trips.status, "scheduled"),
    offlineOccurredAt
      ? sql`${trips.cancelledAt} > ${offlineOccurredAt.toISOString()}::timestamptz`
      : undefined,
    sql`exists (select 1 from ${rollCallEvents} where ${rollCallEvents.tripId} = ${tripId})`,
    sql`exists (select 1 from ${rollCallCrewEvents} where ${rollCallCrewEvents.tripId} = ${tripId})`,
  );
}

/**
 * **Whether this trip's roll call takes writes**, asked with the writers' own
 * predicate (`scheduledOrCountingHeads`) so the manifest never draws a control
 * the writer would refuse, nor hides one it would accept (#2285). False for a
 * trip that is not this shop's.
 */
export async function rollCallOpenOnTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.id, tripId),
        eq(trips.shopId, shopId),
        scheduledOrCountingHeads(tripId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The roll-call event this shop already holds under a device's
 * `clientEventId`, with the seat it is about, or undefined. The offline replay
 * check (`replayVerdict`): asked before any work and again under the seat
 * lock (`recordRollCall`).
 */
async function storedRollCallEvent(
  tx: DbExecutor,
  shopId: string,
  clientEventId: string,
): Promise<StoredOfflineEvent | undefined> {
  const [existing] = await tx
    .select({
      id: rollCallEvents.id,
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
    })
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.clientEventId, clientEventId)))
    .limit(1);
  return existing && { id: existing.id, subject: `${existing.tripId}/${existing.bookingId}` };
}

/** The same question of the crew trail (`recordCrewRollCall`), with the person. */
async function storedCrewRollCallEvent(
  tx: DbExecutor,
  shopId: string,
  clientEventId: string,
): Promise<StoredOfflineEvent | undefined> {
  const [existing] = await tx
    .select({
      id: rollCallCrewEvents.id,
      tripId: rollCallCrewEvents.tripId,
      personId: rollCallCrewEvents.personId,
    })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.shopId, shopId),
        eq(rollCallCrewEvents.clientEventId, clientEventId),
      ),
    )
    .limit(1);
  return existing && { id: existing.id, subject: `${existing.tripId}/${existing.personId}` };
}

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
    /**
     * What the crew observed about a person who is unaccounted for. Kept only
     * at an after-dive checkpoint (`rollCallNoteAllowed`) — a note posted at
     * departure is dropped rather than written, so the append-only trail takes
     * no free text a surface never offered.
     */
    note?: string | null;
    occurredAt?: Date;
  },
): Promise<RecordRollCallOutcome> {
  // One instant for the event and the boat snapshot it keeps (#2300).
  const occurredAt = input.occurredAt ?? nowDate();
  const outcome = await answeringReplayAsDuplicate(
    () => db.transaction((tx) => writeRollCall(tx, input, occurredAt)),
    {
      indexName: "roll_call_events_shop_client_event_unique",
      clientEventId: input.clientEventId,
      source: input.source,
      subject: `${input.tripId}/${input.bookingId}`,
      stored: (clientEventId) => storedRollCallEvent(db, input.shopId, clientEventId),
    },
  );
  // A duplicate offline-sync replay changed nothing, so it raises no signal —
  // every genuine write does, live or offline-applied alike (both funnel
  // through this one function; see ADR 20260726-manifest-push-refresh).
  if (outcome.ok && !outcome.duplicate) {
    await publishManifestEvent(db, input.shopId, input.tripId);
    // The boat's papers and kit as the boat leaves (#2300), for the departure
    // log once the live section is gone. After the commit, and never throws.
    if ((input.checkpoint ?? "departure") === "departure") {
      // As of the tap, not the sync: an offline count made before sailing keeps the boat.
      await captureDepartureBoatSafety(db, input.shopId, input.tripId, occurredAt);
    }
  }
  logOfflineRetractionSignals(input, outcome);
  return outcome;
}

/** `recordRollCall`'s one transaction. */
async function writeRollCall(
  tx: AppTransaction,
  input: Parameters<typeof recordRollCall>[1],
  occurredAt: Date,
): Promise<RecordRollCallOutcome> {
  const checkpoint = input.checkpoint ?? "departure";
  const source = input.source ?? "live";
  const staffId = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
  if (!staffId) return { ok: false, reason: "staff_not_found" };
  if (source === "live" && checkpoint === "departure" && input.status === "boarded") {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
  }

  if (source === "offline" && input.clientEventId) {
    const replayed = replayVerdict(
      await storedRollCallEvent(tx, input.shopId, input.clientEventId),
      `${input.tripId}/${input.bookingId}`,
      "roll_call_events",
    );
    if (replayed) return replayed;
  }

  // The departure, then the seat — the one order every seat writer takes
  // (`lockSeatDeparture`, #2324), so neither this nor the desk ends up
  // holding what the other is waiting for. The booking row `FOR UPDATE` is
  // the one object the desk and the rail share, and until this lock existed
  // they did not share it: the counter took it `FOR UPDATE` while this read
  // was plain, so "the diver is aboard" and "the diver never came" were
  // decided against the same pre-state, and the boat could sail carrying a
  // body whose seat the shop had put back on sale. Raced for real in
  // `roll-call.postgres.test.ts`, which is red the moment this is removed,
  // and `seat-lock-order.postgres.test.ts`, red on the old booking-first order.
  const lockedTripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
  // **Asked again, under the lock** (`checkInBooking` does the same). A
  // device that gave up on a slow sync resends the same id while the request
  // it abandoned may still be running here, holding this lock. The question
  // above was answered before that request committed; asked now, it sees the
  // commit. Without this the replay of a `cleared` reads its own first copy
  // as the newest row and is refused as `retraction_superseded`, and a
  // replayed mark reaches the insert and fails on the unique index.
  if (source === "offline" && input.clientEventId) {
    const replayed = replayVerdict(
      await storedRollCallEvent(tx, input.shopId, input.clientEventId),
      `${input.tripId}/${input.bookingId}`,
      "roll_call_events",
    );
    if (replayed) return replayed;
  }
  if (lockedTripId !== input.tripId) return { ok: false, reason: "booking_unavailable" };
  const [booking] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      personId: bookings.personId,
      participantType: bookings.participantType,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      turnedAwayAt: bookings.turnedAwayAt,
      plannedDives: trips.plannedDives,
      shopId: trips.shopId,
      boatId: trips.boatId,
      capacity: trips.capacity,
      diverCapacity: trips.diverCapacity,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
        scheduledOrCountingHeads(input.tripId, source === "offline" ? occurredAt : null),
      ),
    )
    .limit(1)
    .for("update", { of: bookings });
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
  //
  // The same reading is what the event keeps (issue #2414): a `boarded` event
  // carries what readiness said at that moment, so a record can say "counted
  // aboard while blocked" after the card is later verified. Written, never
  // read to gate; every other status stores nothing.
  let readinessSnapshot: ReadinessSnapshot | null = null;
  if (input.status === "boarded") {
    if (checkpoint === "departure") {
      const readiness = await getBookingReadiness(tx, input.shopId, booking.id);
      if (readiness?.status !== "ready") return { ok: false, reason: "not_ready" };
      readinessSnapshot = readinessSnapshotOf(readiness);
      // A seat the desk turned away and then sold is not the crew's to take
      // back at the gangway: "Boat full. See the desk." (dde-3 #6). Counted
      // under the departure lock taken above, as `undoBookingNoShow` counts.
      // Only here: after a dive the body is on the boat, and the reclaim
      // below stays unrefusable.
      if (isTurnedAwaySeat(booking)) {
        const held = await heldSeatCounts(tx, input.shopId, input.tripId);
        const capacity = await sellableCapacity(tx, booking);
        if (seatRefusal(booking.participantType, { ...booking, capacity }, held)) {
          return { ok: false, reason: "boat_full" };
        }
      }
    } else {
      // The snapshot is a record, so a failed read costs the record and not
      // the count: a savepoint, so even a failed query leaves the transaction
      // usable for the insert below (issue #2414 review).
      try {
        const readiness = await tx.transaction((savepoint) =>
          getBookingReadiness(savepoint, input.shopId, booking.id),
        );
        readinessSnapshot = readiness ? readinessSnapshotOf(readiness) : null;
      } catch (error) {
        log("roll_call.readiness_snapshot_skipped", "error", {
          tripId: input.tripId,
          checkpoint,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  const captureCards =
    source === "live" &&
    checkpoint === "departure" &&
    input.status === "boarded" &&
    booking.identityUnconfirmedAt === null;
  const capturedAt = captureCards ? nowDate() : null;
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
      note: await acceptedRollCallNote(input.note, checkpoint, input.status, () =>
        standingDiverRollCall(tx, {
          shopId: input.shopId,
          tripId: input.tripId,
          bookingId: booking.id,
          checkpoint,
        }),
      ),
      readinessStatus: readinessSnapshot?.status ?? null,
      readinessBlockers: readinessSnapshot?.blockers ?? null,
      // Offline sync observes today, not the cards the device saw at the tap.
      certificationSnapshot: captureCards
        ? boardingCertificationSnapshot(input.shopId, booking.personId)
        : null,
      certificationSnapshotStartedAt: capturedAt,
      certificationSnapshotCapturedAt: capturedAt,
      occurredAt,
    })
    .returning({ id: rollCallEvents.id });
  if (!event) throw new Error("recordRollCall: insert returned no row");
  if (captureCards && capturedAt) {
    // The statement can wait before it completes. A clock adjustment must not
    // make completion precede the start or reject an otherwise valid count.
    const finishedAt = nowDate();
    await tx
      .update(rollCallEvents)
      .set({ certificationSnapshotCapturedAt: finishedAt < capturedAt ? capturedAt : finishedAt })
      .where(and(eq(rollCallEvents.id, event.id), eq(rollCallEvents.shopId, input.shopId)));
  }
  await pauseRecapOnMissingAfterDive(tx, { ...input, checkpoint });
  // The rail has contradicted the desk. Nothing above refused it and nothing
  // here does either (the docblock says why); what happens instead is that
  // the seat the counter released comes back with the body the crew are
  // standing in front of — or looking for.
  //
  // **Both statements that mean the diver sailed, not the boarding alone.**
  // `noShowGate` refuses the desk when the crew get there first; this is the
  // same ordering when they get there second, and for one slice it covered
  // only half of it. A crew member tapping "not back aboard" after a dive on
  // a seat the desk had already released left a `no_show` standing over a
  // diver in the water: the seat had left `SEAT_HELD_STATUSES` at the desk's
  // tap, the counter had already offered it to the wait list, and the
  // glossary's promise that the mark "cannot co-exist with a boarding at any
  // checkpoint" was false in exactly the ordering the offline manifest makes
  // ordinary — after-dive marks are made with no signal and arrive hours
  // later (dive-domain-expert review, issue #1704).
  if (booking.status === "no_show" && standingResultMeansSailed(checkpoint, input.status)) {
    await reclaimReleasedSeat(tx, {
      shopId: input.shopId,
      tripId: input.tripId,
      bookingId: booking.id,
      personId: booking.personId,
      recordedByPersonId: staffId,
      occurredAt,
      // Two facts, two trail lines: "the boat carried somebody the desk had
      // written off" and "the desk wrote off somebody the crew then reported
      // missing" are what an owner reconciling the departure needs told
      // apart, and the second is the one that matters at 18:00.
      missingAfterDive: input.status === "not_boarded",
    });
  }
  return { ok: true, eventId: event.id };
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
        | typeof CLIENT_EVENT_CONFLICT
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
 * Crew hold no booking *as crew*, but a staffer on a shop where staff dive too
 * can hold a seat on the trip they are rostered to. A result here that means
 * they sailed takes back a seat the counter released, exactly as the diver
 * path does (`reclaimReleasedSeat`) — the rail never refuses; it overrules,
 * whichever half of the head count is speaking.
 *
 * **The `source === "offline"` branch is `recordRollCall`'s, mirrored.** Read
 * the two side by side: dedup on `clientEventId` before any other work and
 * again under the trip lock, the shared `offlineEventOutOfBounds` staleness bound, then newest-wins against
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
    /** The same, for the other half of the head count. */
    note?: string | null;
    occurredAt?: Date;
  },
): Promise<RecordCrewRollCallOutcome> {
  // One instant for the event and the boat snapshot it keeps (#2300).
  const occurredAt = input.occurredAt ?? nowDate();
  const outcome = await answeringReplayAsDuplicate(
    () =>
      db.transaction(async (tx): Promise<RecordCrewRollCallOutcome> => {
        const checkpoint = input.checkpoint ?? "departure";
        const source = input.source ?? "live";

        const staffId = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
        if (!staffId) return { ok: false, reason: "staff_not_found" };

        // Idempotency first, exactly as the diver path does it: a sync the device
        // retried (the response never arrived, the tab was closed mid-flight) must
        // not append a second row, and answering `duplicate` before any subject
        // lookup means a replay costs nothing and cannot be refused by a roster
        // that has changed since.
        if (source === "offline" && input.clientEventId) {
          const replayed = replayVerdict(
            await storedCrewRollCallEvent(tx, input.shopId, input.clientEventId),
            `${input.tripId}/${input.personId}`,
            "roll_call_crew_events",
          );
          if (replayed) return replayed;
        }

        // Same tenancy and trip-status gate the other two writers apply — and the
        // trip's lock, taken here, before the crew member's own seat below
        // (#2324's one order: trip, then booking). An after-dive `not_boarded`
        // locks that seat and then updates this row
        // (`pauseRecapOnMissingAfterDive`); booking-then-trip deadlocked against
        // the counter on a staffer's seat (`seat-lock-order.postgres.test.ts`).
        // `no key update`, so the event's own foreign-key `KEY SHARE` passes.
        // Bounded like the diver half's `lockSeatDeparture`: behind a stuck
        // holder the tap fails in five seconds with `55P03` rather than with
        // its function (#2983, `roll-call.postgres.test.ts`).
        await boundLockWaits(tx);
        const [trip] = await tx
          .select({ id: trips.id, plannedDives: trips.plannedDives })
          .from(trips)
          .where(
            and(
              liveTrip(),
              eq(trips.id, input.tripId),
              eq(trips.shopId, input.shopId),
              scheduledOrCountingHeads(input.tripId, source === "offline" ? occurredAt : null),
            ),
          )
          .limit(1)
          .for("no key update", { of: trips });
        // Asked again under the trip lock, for `recordRollCall`'s reason: a resent
        // sync can overlap the request it replaced, and only now does that
        // request's commit show.
        if (source === "offline" && input.clientEventId) {
          const replayed = replayVerdict(
            await storedCrewRollCallEvent(tx, input.shopId, input.clientEventId),
            `${input.tripId}/${input.personId}`,
            "roll_call_crew_events",
          );
          if (replayed) return replayed;
        }
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

        // **The other half of the head count takes the seat back too**
        // (dive-domain-expert review, issue #1686).
        //
        // `onTheWaterByRollCall` answers from two tables — the diver trail and,
        // for a staffer who holds a seat on a trip they crew, this one — so the
        // desk is refused when the crew get there first whichever table spoke. The
        // mirror act was the diver table's alone, which left the desk-first
        // ordering open on exactly the seat the diver path cannot cover: a
        // staffer's own seat is the one that fails readiness, so the crew list is
        // often the only place a boarding for them can be written at all. Marked
        // absent at 08:20 because they went straight to the boat, boarded at the
        // rail at 08:25, and the release stood — the seat sellable to a walk-in
        // while its holder was on the water, and struck from every reader that
        // counts a **dive day**, which hands a divemaster diving five days running
        // the single-day flying wait.
        //
        // **Read here, before the insert, and with a `where` that does not narrow
        // to `no_show`.** Not because the reclaim needs the row early — it does not
        // — but because nothing else on this path touches a booking at all, so
        // without this read the desk and the rail share no lock object and decide
        // against the same pre-state *every* time rather than under a race. The
        // `where` is the other half: narrowing it to `no_show` locks nothing until
        // the desk's mark is already visible, which is the same gap wearing a
        // `FOR UPDATE`. So the row is taken whole and the status it read decides
        // whether there is anything to undo. `roll-call.postgres.test.ts` is red on
        // either shortcut, at the gate rather than at the assertions.
        //
        // The branch that does *not* mean the person sailed — a dock `not_boarded`,
        // a `cleared` — takes no lock, and needs none: it can only ever leave a
        // release standing, never create one. Racing the desk there, the desk
        // either still sees the boarding this event is superseding and refuses, or
        // sees it gone and marks; what it cannot do is release a seat over a
        // standing sailed result, because that is the read it makes under its own
        // lock.
        //
        // **The reclaim hangs off the insert, not off this read**, which is why the
        // two are apart. Moving the read earlier is harmless; moving the *reclaim*
        // to any path that returns without writing is not. An older `boarded`
        // losing newest-wins to a standing `cleared` answers `newer_event_exists`,
        // so nothing stands that means the person sailed — taking their seat back
        // there would leave the booking out of `no_show` with
        // `onTheWaterByRollCall` still answering null about the same human, and a
        // walk-in possibly already holding it. `manifests.test.ts` pins that
        // ordering; nothing else in the file does.
        //
        // The lookup is a probe of `bookings_trip_person_unique`, so the ordinary
        // crew member — who holds no seat — pays one index miss and locks nothing.
        // The trip is already held (`for no key update`, above), so this takes
        // the seat second, in the counter's own order (`lockSeatDeparture`).
        const seat = standingResultMeansSailed(checkpoint, input.status)
          ? ((
              await tx
                .select({ id: bookings.id, status: bookings.status })
                .from(bookings)
                .where(
                  and(
                    eq(bookings.shopId, input.shopId),
                    eq(bookings.tripId, input.tripId),
                    eq(bookings.personId, assigned.personId),
                    ne(bookings.status, "cancelled"),
                  ),
                )
                .limit(1)
                .for("update")
            )[0] ?? null)
          : null;

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
            note: await acceptedRollCallNote(input.note, checkpoint, input.status, () =>
              standingCrewRollCall(tx, {
                shopId: input.shopId,
                tripId: input.tripId,
                personId: input.personId,
                checkpoint,
              }),
            ),
            occurredAt,
          })
          .returning({ id: rollCallCrewEvents.id });
        if (!event) throw new Error("recordCrewRollCall: insert returned no row");
        await pauseRecapOnMissingAfterDive(tx, { ...input, checkpoint });
        // The seat was released and the rail has now said the person sailed, so it
        // comes back with them — the same consequence, the same trail lines and the
        // same one-direction rule as the diver path's (`reclaimReleasedSeat`).
        if (seat?.status === "no_show") {
          await reclaimReleasedSeat(tx, {
            shopId: input.shopId,
            tripId: input.tripId,
            bookingId: seat.id,
            personId: assigned.personId,
            recordedByPersonId: staffId,
            occurredAt,
            missingAfterDive: input.status === "not_boarded",
          });
        }
        return { ok: true, eventId: event.id };
      }),
    {
      indexName: "roll_call_crew_events_shop_client_event_unique",
      clientEventId: input.clientEventId,
      source: input.source,
      subject: `${input.tripId}/${input.personId}`,
      stored: (clientEventId) => storedCrewRollCallEvent(db, input.shopId, clientEventId),
    },
  );
  // Same push signal the other head-count writes raise: this changes whether
  // the checkpoint reads complete on every device holding the manifest open —
  // and, as on the diver path, a duplicate offline replay changed nothing, so
  // it raises none.
  if (outcome.ok && !outcome.duplicate) {
    await publishManifestEvent(db, input.shopId, input.tripId);
    // The boat's papers and kit as the boat leaves (#2300), for the departure
    // log once the live section is gone. After the commit, and never throws.
    if ((input.checkpoint ?? "departure") === "departure") {
      // As of the tap, not the sync: an offline count made before sailing keeps the boat.
      await captureDepartureBoatSafety(db, input.shopId, input.tripId, occurredAt);
    }
  }
  logOfflineRetractionSignals(input, outcome);
  return outcome;
}
