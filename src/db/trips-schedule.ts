import { and, asc, count, eq } from "drizzle-orm";
import { shiftInstantByWallTimeDelta, utcToWallTime, wallTimeDeltaMs } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import type { Trip } from "./schema";
import {
  bookings,
  rollCallCrewAttestations,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripScheduleDays,
  trips,
  tripWaitlistEntries,
} from "./schema";
import { insertTripInstance, resolveCourse } from "./trips-create";
import { recordSeriesSkip } from "./trips-series";

/**
 * The staff schedule builder's mutations: slide a departure to another day,
 * copy one forward, take an untouched one back off the board.
 *
 * These three share one refusal vocabulary and one invariant: a trip anybody
 * has begun counting heads against has **sailed**, and its date is no longer a
 * schedule edit to make. `countRollCallEvidence` is the whole question — divers'
 * roll call, per-person crew roll call, and count-level crew attestation — and
 * both guards ask all of it (review 20260803, D3).
 *
 * Driven by `src/app/shop/[shopSlug]/schedule/board/actions.ts`.
 */

/**
 * Wall-clock delta between an existing start and a new one, computed in the
 * shop's own timezone rather than as a raw millisecond difference — the
 * DST-safe way to move a multi-day trip. `moveTrip`/`duplicateTrip` use this
 * so `endsAt` and every schedule day shift by the same *wall-clock* delta as
 * the start: a whole-day shift alone (the common multi-day-course case)
 * keeps each day's own published hour intact even when the span crosses a
 * DST transition, and a shift that also changes the start's clock time (the
 * common single-day case, e.g. "move to Thursday at 7am instead of 9am")
 * carries that same time change through to `endsAt` so the trip's duration
 * is preserved instead of leaving `endsAt` stuck at its old wall-clock hour
 * (see docs/product/archive/specialist-optimization-audit-20260731.md
 * §7).
 */
function tripShiftPlan(existingStartsAt: Date, newStartsAt: Date, timeZone: string) {
  const deltaMs = wallTimeDeltaMs(
    utcToWallTime(existingStartsAt, timeZone),
    utcToWallTime(newStartsAt, timeZone),
  );
  return (date: Date) => shiftInstantByWallTimeDelta(date, deltaMs, timeZone);
}

export type MoveTripOutcome =
  | { ok: true; trip: Trip }
  | { ok: false; reason: "not_found" | "not_scheduled" | "already_sailed" | "invalid" };

/**
 * Every kind of head-count evidence a trip can carry — the divers' roll call,
 * the per-person crew roll call, and the count-level crew attestation. A trip
 * with any of it has **sailed**, and the two guards that turn on that fact
 * (`moveTrip`, `deleteTrip`) have to ask the whole question.
 *
 * Counting only `rollCallEvents` was the hole: a bookingless charter that
 * carried crew — a boat with a divemaster and no paying divers, or one whose
 * only head count was of its crew — walked past the guard, and `deleteTrip`
 * then deleted it straight into a foreign-key violation instead of refusing
 * cleanly (review 20260803, D3).
 */
async function countRollCallEvidence(tx: DbExecutor, tripId: string): Promise<number> {
  const [[divers], [crew], [attestations]] = await Promise.all([
    tx.select({ n: count() }).from(rollCallEvents).where(eq(rollCallEvents.tripId, tripId)),
    tx.select({ n: count() }).from(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, tripId)),
    tx
      .select({ n: count() })
      .from(rollCallCrewAttestations)
      .where(eq(rollCallCrewAttestations.tripId, tripId)),
  ]);
  return (divers?.n ?? 0) + (crew?.n ?? 0) + (attestations?.n ?? 0);
}

/**
 * Slides a whole departure to a new instant, keeping its shape.
 *
 * The caller sets a new *start*; the end and every schedule day shift by
 * that same wall-clock delta in the shop's own timezone, so a two-tank
 * morning stays three and a half hours long even when the move also changes
 * the start's clock time, and a three-day course stays three days with its
 * second and third mornings at their own published wall-clock hour even
 * when the move crosses a DST transition (a fixed millisecond shift would
 * drift day 2/3 by the DST offset change; see `tripShiftPlan`). Editing the
 * individual windows is still the trip page's job — this is the schedule
 * builder's "drag it to Thursday", nothing more.
 *
 * Refuses a trip that has any roll-call history: the crew has begun counting
 * heads against that departure, and moving the date under a manifest already in
 * progress is not a schedule edit, it is a falsified record. Refuses a cancelled
 * trip for the same reason a cancelled trip is not on the board.
 */
export async function moveTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
): Promise<MoveTripOutcome> {
  if (Number.isNaN(startsAt.getTime())) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.status !== "scheduled") return { ok: false, reason: "not_scheduled" };

    if ((await countRollCallEvidence(tx, tripId)) > 0) {
      return { ok: false, reason: "already_sailed" };
    }

    if (startsAt.getTime() === existing.startsAt.getTime()) return { ok: true, trip: existing };

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return { ok: false, reason: "not_found" };
    const shift = tripShiftPlan(existing.startsAt, startsAt, shop.timezone);

    const [trip] = await tx
      .update(trips)
      .set({ startsAt, endsAt: shift(existing.endsAt) })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };

    const days = await tx
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId));
    for (const day of days) {
      await tx
        .update(tripScheduleDays)
        .set({ startsAt: shift(day.startsAt), endsAt: shift(day.endsAt) })
        .where(eq(tripScheduleDays.id, day.id));
    }
    return { ok: true, trip };
  });
}

export type DeleteTripOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_roster" | "already_sailed" };

/**
 * Takes a departure off the board for good — the schedule builder's "remove".
 *
 * Deliberately *not* how a trip with divers on it goes away. A trip anyone has
 * booked, joined a wait list for, or counted heads against gets cancelled
 * (`setTripStatus`), which keeps the roster, the refund story, and the record
 * that the day existed. Hard deletion is reserved for a departure that was put
 * on the board by mistake and that nobody has touched — there, leaving a
 * cancelled ghost behind is clutter, not history.
 *
 * The guard is checked under a row lock, so a booking landing mid-delete loses
 * the race rather than being silently erased with its trip.
 */
export async function deleteTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<DeleteTripOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: trips.id,
        shopId: trips.shopId,
        seriesId: trips.seriesId,
        seriesOccurrenceDate: trips.seriesOccurrenceDate,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };

    // Any booking at all, cancelled ones included: a cancelled booking is a
    // diver who was once on this manifest, and that is history to keep.
    const [{ roster }] = await tx
      .select({ roster: count() })
      .from(bookings)
      .where(eq(bookings.tripId, tripId));
    if (roster > 0) return { ok: false, reason: "has_roster" };

    const [{ waiting }] = await tx
      .select({ waiting: count() })
      .from(tripWaitlistEntries)
      .where(eq(tripWaitlistEntries.tripId, tripId));
    if (waiting > 0) return { ok: false, reason: "has_roster" };

    if ((await countRollCallEvidence(tx, tripId)) > 0) {
      return { ok: false, reason: "already_sailed" };
    }

    // A removed date must stay removed: a series instance leaves behind a skip
    // so the next horizon roll does not helpfully put it back (see
    // `trip_series_skips`). Written before the delete, in the same transaction,
    // so the two can never disagree.
    await recordSeriesSkip(tx, existing);

    // Children without a cascade of their own, innermost first. `activityEvents`
    // cascades from the trip and needs no line here.
    await tx.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.tripId, tripId));
    await tx.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
    await tx.delete(tripRequirements).where(eq(tripRequirements.tripId, tripId));
    await tx.delete(tripDives).where(eq(tripDives.tripId, tripId));
    await tx.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
    await tx.delete(trips).where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
    return { ok: true };
  });
}

/**
 * Puts a copy of an existing departure on the board at a new instant — "same
 * trip, next Thursday", the move a shop makes twenty times a season.
 *
 * Copies what defines the dive: title, description, course, capacity, planned
 * dives and their sites, prices, and the cancellation window, with every
 * schedule day shifted by the same wall-clock delta as the start (in the
 * shop's own timezone, DST-safe — see `tripShiftPlan`) so a multi-day course
 * keeps its shape and its published wall-clock hours. Copies nothing about
 * the *day*: no roster, no wait list, no crew, no conditions, no series
 * membership. A duplicate is a fresh departure that looks like the old one,
 * never a second view of it.
 */
export async function duplicateTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
): Promise<Trip | null> {
  if (Number.isNaN(startsAt.getTime())) return null;
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1);
    if (!source) return null;

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return null;
    const shift = tripShiftPlan(source.startsAt, startsAt, shop.timezone);
    const [dives, days] = await Promise.all([
      tx
        .select()
        .from(tripDives)
        .where(eq(tripDives.tripId, tripId))
        .orderBy(asc(tripDives.diveNumber)),
      tx
        .select()
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, tripId))
        .orderBy(asc(tripScheduleDays.dayNumber)),
    ]);
    const { ok, course } = await resolveCourse(tx, shopId, source.courseId ?? undefined);
    if (!ok) return null;

    return insertTripInstance(tx, {
      shopId,
      courseId: source.courseId ?? undefined,
      course,
      title: source.title,
      description: source.description ?? undefined,
      startsAt,
      endsAt: shift(source.endsAt),
      capacity: source.capacity,
      plannedDives: source.plannedDives,
      priceCents: source.priceCents,
      depositCents: source.depositCents,
      cancellationWindowHours: source.cancellationWindowHours,
      drafts: dives.map((dive) => ({
        diveNumber: dive.diveNumber,
        title: dive.title,
        diveSiteId: dive.diveSiteId,
        description: dive.description,
      })),
      scheduleDays: days.map((day) => ({
        dayNumber: day.dayNumber,
        startsAt: shift(day.startsAt),
        endsAt: shift(day.endsAt),
      })),
    });
  });
}
