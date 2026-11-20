import { and, desc, eq } from "drizzle-orm";
import { requireActiveStaffId } from "@/db/authz";
import type { AppDb, DbExecutor } from "@/db/client";
import { bookings, diveParticipationNotes, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { seatNotCancelled } from "@/db/trips-queries";
import { type DiveParticipation, isDiveParticipation } from "@/lib/dive-participation";

/**
 * **Dive participation notes** (issue #4307): the crew saying one diver dived,
 * sat out, or is unknown for one dive. Append-only; the newest row per
 * (booking, dive) is the note, and no row reads as `unknown`. Informs only:
 * nothing here reads or writes the roll call, readiness, a medical hold or
 * fly-safe.
 */

export type RecordDiveParticipationOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "staff_not_found" | "trip_not_found" | "dive_invalid" | "seat_not_found";
    };

/** Record a note. Re-proves the staffer, the departure, its dive and the seat against the shop. */
export async function recordDiveParticipation(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    diveNumber: number;
    participation: DiveParticipation;
    recordedByPersonId: string;
  },
): Promise<RecordDiveParticipationOutcome> {
  if (!isDiveParticipation(input.participation)) return { ok: false, reason: "invalid" };
  if (!(await requireActiveStaffId(db, input.shopId, input.recordedByPersonId))) {
    return { ok: false, reason: "staff_not_found" };
  }
  const [trip] = await db
    .select({ plannedDives: trips.plannedDives })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "trip_not_found" };
  if (
    !Number.isInteger(input.diveNumber) ||
    input.diveNumber < 1 ||
    input.diveNumber > trip.plannedDives
  ) {
    return { ok: false, reason: "dive_invalid" };
  }
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.tripId, input.tripId),
        eq(bookings.shopId, input.shopId),
        seatNotCancelled,
      ),
    )
    .limit(1);
  if (!seat) return { ok: false, reason: "seat_not_found" };
  await db.insert(diveParticipationNotes).values({
    shopId: input.shopId,
    tripId: input.tripId,
    bookingId: input.bookingId,
    diveNumber: input.diveNumber,
    participation: input.participation,
    recordedByPersonId: input.recordedByPersonId,
  });
  return { ok: true };
}

/**
 * The newest note per seat and dive on one departure, by booking id then dive
 * number. A seat and dive nobody spoke for is absent, which is `unknown`.
 */
export async function diveParticipationForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<ReadonlyMap<string, ReadonlyMap<number, DiveParticipation>>> {
  const rows = await db
    .select({
      bookingId: diveParticipationNotes.bookingId,
      diveNumber: diveParticipationNotes.diveNumber,
      participation: diveParticipationNotes.participation,
    })
    .from(diveParticipationNotes)
    .where(
      and(eq(diveParticipationNotes.shopId, shopId), eq(diveParticipationNotes.tripId, tripId)),
    )
    .orderBy(desc(diveParticipationNotes.seq));
  const latest = new Map<string, Map<number, DiveParticipation>>();
  for (const row of rows) {
    const seat = latest.get(row.bookingId) ?? new Map<number, DiveParticipation>();
    if (!seat.has(row.diveNumber)) seat.set(row.diveNumber, row.participation);
    latest.set(row.bookingId, seat);
  }
  return latest;
}

/** The dives the crew's newest note says this seat sat out. */
export async function satOutDives(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<ReadonlySet<number>> {
  const rows = await db
    .select({
      diveNumber: diveParticipationNotes.diveNumber,
      participation: diveParticipationNotes.participation,
    })
    .from(diveParticipationNotes)
    .where(
      and(
        eq(diveParticipationNotes.shopId, shopId),
        eq(diveParticipationNotes.tripId, tripId),
        eq(diveParticipationNotes.bookingId, bookingId),
      ),
    )
    .orderBy(desc(diveParticipationNotes.seq));
  const seen = new Set<number>();
  const satOut = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.diveNumber)) continue;
    seen.add(row.diveNumber);
    if (row.participation === "sat_out") satOut.add(row.diveNumber);
  }
  return satOut;
}
