import { and, asc, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { seatsWithinCertificate } from "@/lib/boat-safety";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { tripReservationWindow } from "@/lib/gear";
import { shiftWeek } from "@/lib/week-board";
import {
  shiftInstantByCalendarDays,
  shiftInstantByWallTimeDelta,
  utcToWallTime,
  wallTimeDeltaMs,
  wallTimeToUtc,
} from "@/lib/zoned";
import { rebindDepartureBoatSafetyTime } from "./boat-safety";
import type { AppDb, DbExecutor } from "./client";
import { clearCrewAwayAcknowledgements } from "./crew-away-acknowledgements";
import { flushUrgentCrewNotices, recordCrewTimeMoved } from "./crew-notices";
import { rewindowTripGearReservations } from "./gear";
import { publishManifestEvent } from "./manifest-events";
import { queryAll } from "./query-helpers";
import { rearmTripReminders } from "./reminder-rearm";
import type { Trip } from "./schema";
import {
  bookings,
  interests,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripDives,
  tripScheduleDays,
  trips,
} from "./schema";
import { forgetTranslationsOf } from "./shop-text-translations";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { insertTripInstance, resolveCourse, validateBoat } from "./trips-create";
import { liveTrip } from "./trips-live";
import { boatCertifiedPassengers } from "./trips-queries";
import { recordSeriesSkip } from "./trips-series";

/**
 * The staff schedule builder's mutations: slide a departure to another day,
 * copy one forward, take an untouched one back off the board.
 *
 * These three share one refusal vocabulary and one invariant: a trip anybody
 * has begun counting heads against has **sailed**, and its date is no longer a
 * schedule edit to make. `countRollCallEvidence` is the whole question — the
 * divers' roll call and the crew roll call — and both guards ask all of it
 * (review 20260803, D3).
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
/**
 * The shift `moveTrip` applies: every instant of a departure moved by the same
 * **wall-clock** delta, so a multi-day block keeps its published times across
 * a DST boundary instead of drifting by the offset change.
 *
 * Exported for the schedule builder's move preview (`crewMoveConflicts`,
 * src/db/trips-crew.ts), for the same reason `countRollCallEvidence` is: a
 * preview that computed where the boat lands by its own arithmetic would drift
 * from where it actually lands, and the drift would show as a warning about a
 * clash that never happens — or silence about one that does.
 */
export function tripShiftPlan(existingStartsAt: Date, newStartsAt: Date, timeZone: string) {
  const deltaMs = wallTimeDeltaMs(
    utcToWallTime(existingStartsAt, timeZone),
    utcToWallTime(newStartsAt, timeZone),
  );
  return (date: Date) => shiftInstantByWallTimeDelta(date, deltaMs, timeZone);
}

export type MoveTripOutcome =
  | {
      ok: true;
      trip: Trip;
      /** Where the departure sat before the move: what its divers were told. */
      previousStartsAt: Date;
      /**
       * Gear reservations the move could not carry onto the new dates, because
       * the unit is already spoken for there. Released rather than left
       * pointing at days the departure no longer occupies — and counted here
       * because the board has to say so: a silently released reservation is a
       * unit somebody thinks is packed (`rewindowTripGearReservations`).
       */
      gearReleased: number;
    }
  | { ok: false; reason: "not_found" | "not_scheduled" | "already_sailed" | "invalid" };

/**
 * Every kind of head-count evidence a trip can carry — the divers' roll call
 * and the crew roll call. A trip with any of it has **sailed**, and the two
 * guards that turn on that fact (`moveTrip`, `deleteTrip`) have to ask the
 * whole question.
 *
 * Counting only `rollCallEvents` was the hole: a bookingless charter that
 * carried crew — a boat with a divemaster and no paying divers, or one whose
 * only head count was of its crew — walked past the guard, and `deleteTrip`
 * then deleted it straight into a foreign-key violation instead of refusing
 * cleanly (review 20260803, D3).
 *
 * Exported so the schedule builder's move preview asks the *same* question the
 * guard does (`src/db/move-preflight.ts`, issue #1203). A preview with its own
 * copy of this rule would drift, and the drift would show up as a panel
 * promising a move the mutation then refuses.
 *
 * Deliberately stricter than the rehearsal sweep's `rehearsalsWithEvidence`
 * (`src/db/rehearsals.ts`), which treats a dockside `not_boarded` as
 * clerical: a person is refused on any row, and only the automatic sweep
 * clears a clerical-only rehearsal. Both policies are stated there.
 */
export async function countRollCallEvidence(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  // `queryAll`, not `Promise.all`: every caller of this is a transaction --
  // one checked-out pg client, which queues a fan-out and warns that pg@9 will
  // refuse it (issue #517, the file's other reader below).
  const [[divers], [crew]] = await queryAll(tx, [
    () =>
      tx
        .select({ n: count() })
        .from(rollCallEvents)
        .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.tripId, tripId))),
    () =>
      tx
        .select({ n: count() })
        .from(rollCallCrewEvents)
        .where(and(eq(rollCallCrewEvents.shopId, shopId), eq(rollCallCrewEvents.tripId, tripId))),
  ]);
  return (divers?.n ?? 0) + (crew?.n ?? 0);
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
 *
 * **The crew hear it** (#2283): everyone on the departure but the staffer who
 * moved it gets a `time_moved` crew notice with the time it left before, sent
 * at once when either time is within a day and otherwise on the hour.
 */
export async function moveTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
  options: { actorPersonId?: string | null; now?: Date } = {},
): Promise<MoveTripOutcome> {
  if (Number.isNaN(startsAt.getTime())) return { ok: false, reason: "invalid" };
  const now = options.now ?? nowDate();
  let moved = false;
  const outcome = await db.transaction(async (tx): Promise<MoveTripOutcome> => {
    await lockTripRevisionNotificationFence(tx, shopId, tripId, "revision-write");
    const [existing] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.status !== "scheduled") return { ok: false, reason: "not_scheduled" };

    if ((await countRollCallEvidence(tx, shopId, tripId)) > 0) {
      return { ok: false, reason: "already_sailed" };
    }

    if (startsAt.getTime() === existing.startsAt.getTime())
      return { ok: true, trip: existing, previousStartsAt: existing.startsAt, gearReleased: 0 };

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return { ok: false, reason: "not_found" };
    const shift = tripShiftPlan(existing.startsAt, startsAt, shop.timezone);

    const [trip] = await tx
      .update(trips)
      .set({
        startsAt,
        endsAt: shift(existing.endsAt),
        // A move is the material change (issue #1165): every subscribed
        // calendar has to re-alert, or a diver stands at the dock at the old
        // time. Safe to write unconditionally here — the equal-instant case
        // returned above, so reaching this line means the boat really moved.
        revision: sql`${trips.revision} + 1`,
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };

    await rebindDepartureBoatSafetyTime(tx, shopId, tripId, existing.startsAt, trip.startsAt, now);

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

    // The gear goes with the departure. A reservation's window is derived from
    // the trip's dates at assign time and never re-read, so without this the
    // boat leaves on Thursday with kit the register still believes is out on
    // Tuesday — free to be double-assigned, and overdue on the wrong day.
    const gear = await rewindowTripGearReservations(tx, {
      shopId,
      tripId,
      window: tripReservationWindow(trip, shop.timezone),
    });
    // The divers' reminders fire again for the new date (#2444).
    await rearmTripReminders(tx, { shopId, tripId });
    // "Working it anyway" was said about the old dates (#2678 reviews).
    await clearCrewAwayAcknowledgements(tx, { shopId, tripId });
    await recordCrewTimeMoved(tx, {
      shopId,
      tripId,
      previousStartsAt: existing.startsAt,
      actorPersonId: options.actorPersonId ?? null,
      now,
    });
    moved = true;
    return {
      ok: true,
      trip,
      previousStartsAt: existing.startsAt,
      gearReleased: gear.released,
    };
  });
  // Late news goes now, not on the hour (`flushUrgentCrewNotices`).
  if (moved) {
    await flushUrgentCrewNotices(db, { shopId, tripIds: [tripId], now });
    // Its manifest, and any charter whose training mark rests on its times.
    await publishManifestEvent(db, shopId, tripId);
  }
  return outcome;
}

export type DeleteTripOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_roster" | "already_sailed" };

/**
 * Takes a departure off the board — the schedule builder's "remove".
 *
 * Deliberately *not* how a trip with divers on it goes away. A trip anyone has
 * booked, joined a wait list for, or counted heads against gets cancelled
 * (`setTripStatus`), which keeps the roster, the refund story, and the record
 * that the day existed. This is for a departure that was put on the board by
 * mistake and that nobody has touched — there, leaving a cancelled ghost behind
 * is clutter, not history.
 *
 * **Soft, like every other delete** (ADR 20260820-every-delete-is-soft). It
 * stamps `trips.deleted_at` and leaves the row and all five child tables where
 * they are; the children are unreachable the moment the parent stops matching
 * {@link liveTrip}, which is what makes putting the departure back a single
 * column write instead of a rebuild of its dive plan and crew.
 *
 * The guard is checked under a row lock, so a booking landing mid-delete loses
 * the race rather than being silently hidden with its trip. The two refusals
 * are unchanged and are **not** softened by the row surviving: a departure with
 * a roster is a different question — those divers need telling — and a sailed
 * one is history rather than clutter.
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
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
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
      .from(interests)
      .where(
        and(
          eq(interests.scope, "departure"),
          eq(interests.askedBy, "diver"),
          eq(interests.tripId, tripId),
        ),
      );
    if (waiting > 0) return { ok: false, reason: "has_roster" };

    if ((await countRollCallEvidence(tx, shopId, tripId)) > 0) {
      return { ok: false, reason: "already_sailed" };
    }

    // A removed date must stay removed: a series instance leaves behind a skip
    // so the next horizon roll does not helpfully put it back (see
    // `trip_series_skips`). Written before the stamp, in the same transaction,
    // so the two can never disagree. Still required with the row surviving —
    // the roll reads the cadence, not the board, and would materialize a second
    // instance for a date whose first one is merely hidden.
    await recordSeriesSkip(tx, existing);

    await tx
      .update(trips)
      .set({ deletedAt: nowDate() })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), isNull(trips.deletedAt)));
    // Its Spanish description goes with it: a removed date is never shown again.
    await forgetTranslationsOf(tx, shopId, "trip", tripId);
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
  db: DbExecutor,
  shopId: string,
  tripId: string,
  startsAt: Date,
): Promise<Trip | null> {
  if (Number.isNaN(startsAt.getTime())) return null;
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1);
    if (!source) return null;

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return null;
    const shift = tripShiftPlan(source.startsAt, startsAt, shop.timezone);
    // Sequential, not `Promise.all`: a transaction is one checked-out client,
    // so concurrent queries on `tx` cannot overlap anyway -- pg queues them and
    // warns that it will stop accepting them in pg@9. The parallelism was
    // never real; only the deprecation warning was (issue #517).
    const dives = await tx
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, tripId))
      .orderBy(asc(tripDives.diveNumber));
    const days = await tx
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId))
      .orderBy(asc(tripScheduleDays.dayNumber));
    const { ok, course } = await resolveCourse(tx, shopId, source.courseId ?? undefined);
    if (!ok) return null;
    // Re-checked rather than trusted, even though it is being copied from a
    // row this shop already owns: a bad id written before `validateBoat`
    // existed would otherwise propagate on every copy, which is how one
    // cross-tenant row becomes a season of them.
    const boatId = (await validateBoat(tx, shopId, source.boatId)) ? source.boatId : null;
    // **A copy starts inside the certificate** (H-107). The source may predate
    // the refusal, or sit on a hull whose certificate was recorded since; the
    // copy takes the lower number rather than carrying the old one forward.
    const seats = seatsWithinCertificate(
      { capacity: source.capacity, diverCapacity: source.diverCapacity },
      await boatCertifiedPassengers(tx, shopId, boatId),
    );

    return insertTripInstance(tx, {
      shopId,
      courseId: source.courseId ?? undefined,
      course,
      title: source.title,
      description: source.description ?? undefined,
      startsAt,
      endsAt: shift(source.endsAt),
      capacity: seats.capacity,
      plannedDives: source.plannedDives,
      priceCents: source.priceCents,
      depositCents: source.depositCents,
      // A copy carries the same snorkel and ride-along seats; it holds no
      // bookings yet, so no limit can fall below the divers aboard.
      snorkelerPriceCents: source.snorkelerPriceCents,
      riderPriceCents: source.riderPriceCents,
      diverCapacity: seats.diverCapacity,
      cancellationWindowHours: source.cancellationWindowHours,
      isPrivate: source.isPrivate,
      // A copy of a rehearsal is a rehearsal: copying a practice day forward
      // must not put a real, bookable departure on the board.
      isRehearsal: source.isRehearsal,
      // Copied like every other stated fact about the departure. A shop that
      // marked a charter self-guided and then copied it to next Saturday must
      // not find the copy raising the row the mark exists to silence.
      selfGuided: source.selfGuided,
      // Copied too: a copy of a decompression charter is one (H-84).
      exceedsNoDecoLimits: source.exceedsNoDecoLimits,
      diveMode: source.diveMode,
      // Copied outright, and deliberately *not* re-checked through
      // `getTripLens` the way `boatId` is below. A boat id is re-validated
      // because rows predate `validateBoat`; `lens_id` has only ever been
      // written behind a tenant check, and a soft-deleted lens must keep
      // travelling — `deleteTripLens` says in as many words that a past day
      // still says which kind of day it was.
      lensId: source.lensId,
      // Re-checked above (`validateBoat`).
      boatId,
      drafts: dives.map((dive) => ({
        diveNumber: dive.diveNumber,
        title: dive.title,
        diveSiteId: dive.diveSiteId,
        description: dive.description,
        // The same sites in the same order is the same run out and back, so a
        // copied departure keeps its legs (ADR 20260815-per-leg-travel-minutes).
        travelMinutes: dive.travelMinutes,
      })),
      scheduleDays: days.map((day) => ({
        dayNumber: day.dayNumber,
        startsAt: shift(day.startsAt),
        endsAt: shift(day.endsAt),
      })),
    });
  });
}

/** 52 weeks: the same weekday a year on, so a Saturday boat lands on a Saturday. */
export const YEAR_OF_WEEKS = 52;

/** The instants a shop-local week runs between, Monday 00:00 to the next. */
function weekWindow(weekStart: CalendarDate, timeZone: string): { from: Date; to: Date } {
  const midnight = (iso: CalendarDate) => {
    const [year, month, day] = iso.split("-").map(Number);
    return wallTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
  };
  return { from: midnight(weekStart), to: midnight(shiftWeek(weekStart, 1)) };
}

/**
 * The departures a year-ago week ran that a copy would put back up: live,
 * scheduled, not a rehearsal, and starting inside that week (a course that
 * began the Sunday before belongs to the week before, as the copy would).
 */
export async function departuresWeekBefore(
  db: DbExecutor,
  shopId: string,
  weekStart: CalendarDate,
  timeZone: string,
): Promise<{ id: string; startsAt: Date }[]> {
  const { from, to } = weekWindow(shiftWeek(weekStart, -YEAR_OF_WEEKS), timeZone);
  return db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isRehearsal, false),
        gte(trips.startsAt, from),
        lt(trips.startsAt, to),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
}

export type CopyWeekOutcome =
  | { ok: true; tripIds: string[] }
  | { ok: false; reason: "week_not_empty" | "nothing_to_copy" };

/**
 * **"Last year this week: 6 departures. Copy them here"** (fifth loop, item
 * 30). Puts last year's week back on an empty one, each departure 52 weeks on
 * at its own wall-clock time, through `duplicateTrip` so every copy is
 * re-checked as one the builder made (the hull's certificate, the course).
 * Crew is never copied: who is free a year on is a new question.
 *
 * Refuses a week that already has a live departure starting in it, so a
 * second tap, or a staffer who added a boat meanwhile, can never double the
 * week. A departure whose copy would already have left is skipped.
 */
export async function copyWeekFromYearBefore(
  db: AppDb,
  shopId: string,
  weekStart: CalendarDate,
  timeZone: string,
  now: Date = nowDate(),
): Promise<CopyWeekOutcome> {
  const { from, to } = weekWindow(weekStart, timeZone);
  return db.transaction(async (tx) => {
    // The shop row, locked, so two taps at once queue behind one another and
    // the second finds the week no longer empty.
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).for("no key update");
    const [present] = await tx
      .select({ n: count() })
      .from(trips)
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          gte(trips.startsAt, from),
          lt(trips.startsAt, to),
        ),
      );
    if ((present?.n ?? 0) > 0) return { ok: false, reason: "week_not_empty" };
    const sources = await departuresWeekBefore(tx, shopId, weekStart, timeZone);
    const tripIds: string[] = [];
    for (const source of sources) {
      const startsAt = shiftInstantByCalendarDays(source.startsAt, YEAR_OF_WEEKS * 7, timeZone);
      if (!(startsAt.getTime() > now.getTime())) continue;
      const copy = await duplicateTrip(tx, shopId, source.id, startsAt);
      if (copy) tripIds.push(copy.id);
    }
    return tripIds.length > 0 ? { ok: true, tripIds } : { ok: false, reason: "nothing_to_copy" };
  });
}
