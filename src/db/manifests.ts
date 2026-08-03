import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import { STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { effectiveCrewRoles } from "@/lib/crew-roles";
import { rentalFitLine } from "@/lib/dive-prep";
import {
  buildTripManifest,
  type CrewAttestation,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  type ManifestCrewMember,
  type RollCallCheckpoint,
  type RollCallRecord,
  rollCallCheckpoints,
  type TripManifest,
} from "@/lib/manifests";
import { medicalWaiverMark } from "@/lib/waivers";
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
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
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
      roles: [],
      shopRoles: [],
    };
    crew.shopRoles.push(role);
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

/**
 * The latest crew attestation per checkpoint for one trip. Append-only, so
 * "latest" is newest `occurredAt` (then `createdAt` to break a tie), exactly
 * like `listLatestRollCallByBooking` — an earlier count is superseded, never
 * rewritten.
 */
async function listLatestCrewAttestations(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<Map<string, CrewAttestation>> {
  const rows = await db
    .select({ attestation: rollCallCrewAttestations, attester: people })
    .from(rollCallCrewAttestations)
    .innerJoin(people, eq(people.id, rollCallCrewAttestations.attestedByPersonId))
    .where(
      and(eq(rollCallCrewAttestations.shopId, shopId), eq(rollCallCrewAttestations.tripId, tripId)),
    )
    .orderBy(desc(rollCallCrewAttestations.occurredAt), desc(rollCallCrewAttestations.createdAt));
  const latest = new Map<string, CrewAttestation>();
  for (const { attestation, attester } of rows) {
    if (latest.has(attestation.checkpoint)) continue;
    latest.set(attestation.checkpoint, {
      crewAboard: attestation.crewAboard,
      crewAssigned: attestation.crewAssigned,
      attestedByName: attester.fullName,
      occurredAt: attestation.occurredAt,
      note: attestation.note,
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
 * Bookings whose latest departure roll-call record is "boarded", across
 * multiple trips at once. This is the manifest's half of the same coupling
 * task 149 closes from the other side (`checkedIn` on `ManifestDiverInput`):
 * `checked_in` used to have exactly one reader in the app, the check-in page,
 * and boarding was invisible there. A later `cleared` event still wins over
 * an older `boarded` one — same "latest event, not latest boarded event"
 * semantics as `listLatestRollCallByBooking` — so an undone board correctly
 * drops out of the returned set.
 */
export async function listDepartureBoardedBookingIds(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .select({ bookingId: rollCallEvents.bookingId, status: rollCallEvents.status })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        inArray(rollCallEvents.tripId, tripIds),
        eq(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(desc(rollCallEvents.occurredAt), desc(rollCallEvents.createdAt));
  const seen = new Set<string>();
  const boarded = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.bookingId)) continue;
    seen.add(row.bookingId);
    if (row.status === "boarded") boarded.add(row.bookingId);
  }
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
    crewAttestations,
    crewRollCalls,
    ...rollCalls
  ] = await Promise.all([
    getShopById(db, shopId),
    getTripRoster(db, shopId, tripId),
    listTripReadiness(db, shopId, tripId),
    verifiedNitroxPersonIds(db, shopId),
    rentalFitByBooking(db, shopId, tripId),
    listTripCrew(db, shopId, tripId),
    listLatestCrewAttestations(db, shopId, tripId),
    listLatestCrewRollCalls(db, shopId, tripId),
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
      })),
      crewAttestation: crewAttestations.get(checkpoint) ?? null,
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
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

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
      const savedAt = input.offlineSnapshotSavedAt;
      const now = nowDate();
      if (
        !input.clientEventId ||
        !savedAt ||
        savedAt.getTime() > occurredAt.getTime() + 5 * 60 * 1000 ||
        occurredAt.getTime() > now.getTime() + 5 * 60 * 1000
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
        recordedByPersonId: staff.id,
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
  | { ok: true; eventId: string }
  | {
      ok: false;
      reason: "trip_unavailable" | "staff_not_found" | "crew_not_assigned" | "invalid_checkpoint";
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
    note?: string;
    occurredAt?: Date;
  },
): Promise<RecordCrewRollCallOutcome> {
  const outcome = await db.transaction(async (tx): Promise<RecordCrewRollCallOutcome> => {
    const checkpoint = input.checkpoint ?? "departure";
    const occurredAt = input.occurredAt ?? nowDate();

    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

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

    const [assigned] = await tx
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(
        and(
          eq(tripAssignments.tripId, input.tripId),
          eq(tripAssignments.personId, input.personId),
          eq(trips.shopId, input.shopId),
          eq(people.shopId, input.shopId),
        ),
      )
      .limit(1);
    if (!assigned) return { ok: false, reason: "crew_not_assigned" };

    const [event] = await tx
      .insert(rollCallCrewEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        personId: assigned.personId,
        recordedByPersonId: staff.id,
        status: input.status,
        checkpoint,
        note: input.note?.trim() || null,
        occurredAt,
      })
      .returning({ id: rollCallCrewEvents.id });
    if (!event) throw new Error("recordCrewRollCall: insert returned no row");
    return { ok: true, eventId: event.id };
  });
  // Same push signal the other head-count writes raise: this changes whether
  // the checkpoint reads complete on every device holding the manifest open.
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
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

    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.attestedByPersonId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };

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
        attestedByPersonId: staff.id,
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
