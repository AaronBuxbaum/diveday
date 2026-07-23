import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { rentalFitLine } from "@/lib/dive-prep";
import {
  buildTripManifest,
  carryForwardNotBoarded,
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  type TripManifest,
} from "@/lib/manifests";
import { medicalWaiverMark } from "@/lib/waivers";
import type { AppDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { rentalFitByBooking } from "./rental-fit";
import { bookings, people, personRoles, rollCallEvents, tripAssignments, trips } from "./schema";
import { getTripRoster, getTripWithBooked } from "./trips";

async function listTripCrew(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ person: people, role: personRoles.role })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        eq(people.shopId, shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(people.fullName));
  const byId = new Map<string, { fullName: string; roles: string[] }>();
  for (const { person, role } of rows) {
    const crew = byId.get(person.id) ?? { fullName: person.fullName, roles: [] };
    crew.roles.push(role);
    byId.set(person.id, crew);
  }
  return [...byId.values()];
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
  const [roster, readinessRows, certified, fitByBooking, crew, ...rollCalls] = await Promise.all([
    getTripRoster(db, shopId, tripId),
    listTripReadiness(db, shopId, tripId),
    verifiedNitroxPersonIds(db, shopId),
    rentalFitByBooking(db, shopId, tripId),
    listTripCrew(db, shopId, tripId),
    ...checkpoints.map((checkpoint) => listLatestRollCallByBooking(db, shopId, tripId, checkpoint)),
  ]);
  const readinessByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, row.readiness] as const),
  );
  // When/how each diver's medical currency was last established, for spotting a
  // stale medical. Digital and staff-attested paper reviews both resolve here;
  // a pending/in-review record resolves to null.
  const medicalByBooking = new Map(
    readinessRows.map((row) => [row.booking.id, medicalWaiverMark(row.waiver)] as const),
  );
  const tripInput = {
    id: trip.id,
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    plannedDives: trip.plannedDives,
  };
  const diverInputs = roster.map(({ booking, person }) => ({
    bookingId: booking.id,
    fullName: person.fullName,
    email: person.email,
    emergencyContactName: person.emergencyContactName,
    emergencyContactPhone: person.emergencyContactPhone,
    readiness: readinessByBooking.get(booking.id),
    rentalFit: rentalFitLine(fitByBooking.get(booking.id) ?? null),
    // The card is re-checked here, so a revoked card takes the request off the manifest.
    nitroxRequested: booking.wantsNitrox && certified.has(person.id),
    medicalWaiver: medicalByBooking.get(booking.id) ?? null,
  }));
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
  return checkpoints.map((checkpoint, index) =>
    buildTripManifest({
      trip: tripInput,
      checkpoint,
      crew,
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
  return db.transaction(async (tx): Promise<RecordRollCallOutcome> => {
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
  return true;
}
