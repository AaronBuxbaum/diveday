/**
 * Gear: what is due back, overdue, or came home fit-adjusted. Imported
 * through the `./gear` barrel.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, type SQL } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind } from "@/lib/gear";
import {
  SIZED_RENTAL_FIT_COLUMN,
  type SizedRentalKind,
  sizedRentalKindOfGearKind,
} from "@/lib/rentals";
import type { AppDb } from "./client";
import type { GearReservationActionOutcome } from "./gear-reservations";
import { liveGearItem, openGearReservation, optional, reservationHolder } from "./gear-shared";
import { bookings, gearItems, gearReservations, people, rentalFitProfiles, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type GearReturnRow = {
  reservationId: string;
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  reservedFrom: CalendarDate;
  reservedUntil: CalendarDate;
  checkedOutAt: Date | null;
  personId: string;
  personName: string;
  tripTitle: string | null;
};

/**
 * Open reservations whose window ends today (`dueBackOn`) or has already
 * passed (`overdueAsOf`) — the register's returns panel and the Today queue's
 * gear rows both read these, so the two can never disagree.
 */
export async function listGearDueBack(
  db: AppDb,
  shopId: string,
  dueBackOn: CalendarDate,
): Promise<GearReturnRow[]> {
  return listReturnRows(db, shopId, eq(gearReservations.reservedUntil, dueBackOn));
}

/** One unit that came home today in a size the diver's fit does not record. */
export type FitAdjustedReturn = {
  reservationId: string;
  personId: string;
  personName: string;
  /** Which fit column the size would be kept in. */
  kind: SizedRentalKind;
  unitLabel: string;
  /** The size that actually went out. Free text, as the shop wrote it. */
  size: string;
  tripTitle: string | null;
  tripEndsAt: Date | null;
  /** What the fit records for this kind today. Null when nothing does. */
  recordedSize: string | null;
};

/**
 * **What the day already taught the shop about a diver's size** (issue #1174,
 * delight report D14).
 *
 * A `fit_adjusted` return is the desk saying, at the counter, that the unit
 * that went out was not the one the fit named — which is exactly D14's
 * "staff-confirmed outcome" and needs no new flag to be readable. This finds
 * the ones where the size genuinely differs from what is on file, so the
 * evening can ask once whether to keep it.
 *
 * **Bounded to the shop's own day**, because the question expires with it: a
 * row that reappeared every evening until somebody answered would be the nag
 * this whole surface is against. The
 * `fit_adjusted` outcome stays on the reservation for anyone who wants it
 * later.
 *
 * **Gear stays opt-in by presence** (ADR 20260815-minimal-gear-register): the
 * read starts at `gear_reservations`, so a shop with no fleet produces no rows
 * and no surface anywhere changes. A post-trip prompt appearing for a shop
 * that does not rent gear is the exact trap #1174's triage names.
 */
export async function listFitAdjustedReturns(
  db: AppDb,
  shopId: string,
  returnedWithin: { from: Date; to: Date },
): Promise<FitAdjustedReturn[]> {
  const rows = await db
    .select({
      reservationId: gearReservations.id,
      personId: bookings.personId,
      personName: people.fullName,
      gearKind: gearItems.kind,
      unitLabel: gearItems.label,
      size: gearItems.size,
      tripTitle: trips.title,
      tripEndsAt: trips.endsAt,
      fit: rentalFitProfiles,
    })
    .from(gearReservations)
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(
      rentalFitProfiles,
      and(eq(rentalFitProfiles.personId, bookings.personId), eq(rentalFitProfiles.shopId, shopId)),
    )
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(gearReservations.returnOutcome, "fit_adjusted"),
        isNotNull(gearReservations.returnedAt),
        gte(gearReservations.returnedAt, returnedWithin.from),
        lt(gearReservations.returnedAt, returnedWithin.to),
        isNotNull(gearItems.size),
        liveGearItem(),
      ),
    )
    .orderBy(asc(people.fullName), asc(gearItems.label));

  return rows.flatMap((row): FitAdjustedReturn[] => {
    const kind = sizedRentalKindOfGearKind(row.gearKind);
    const size = row.size?.trim();
    if (!kind || !size) return [];
    const recordedSize = row.fit?.[SIZED_RENTAL_FIT_COLUMN[kind]]?.trim() || null;
    // Nothing to ask about when the fit already says what went out. The
    // question is only worth a staffer's evening when the two disagree.
    if (recordedSize === size) return [];
    return [
      {
        reservationId: row.reservationId,
        personId: row.personId,
        personName: row.personName,
        kind,
        unitLabel: row.unitLabel,
        size,
        tripTitle: row.tripTitle,
        tripEndsAt: row.tripEndsAt,
        recordedSize,
      },
    ];
  });
}

/**
 * **The same teaching, re-proved from the reservation the tap names** (issue
 * #1453's `security-reviewer` pass on the guardian layer, which read this one
 * next door).
 *
 * `keepRentalFitAction` used to take the size as an argument. The docblock's
 * whole authorization argument was that the row it lands on "exists only
 * because the desk already recorded a `fit_adjusted` return, so this writes
 * down what a human already decided rather than making a new call" — which is
 * why it is open to every staff role, against `canOverrideGearRequest`
 * reserving an overwrite of a diver's stated size for owner, manager,
 * instructor and divemaster. Nothing enforced it: a crew member could post any
 * person id in their shop with any string and rewrite that diver's fit.
 *
 * So the tap now names the reservation and the size comes from here. Same
 * predicates as `listFitAdjustedReturns` above, minus two:
 *
 * - **No day window.** That bound is about when the shop is *asked* — the
 *   question expires with the evening — not about whether the desk's recorded outcome is true. A tap
 *   that lands at 00:01, or a replayed id from last week, still writes a size
 *   a named staffer recorded at the counter for that diver, which is the whole
 *   of the claim.
 * - **No "differs from what is on file" check.** That decides whether the
 *   question is worth an evening; confirming a size that already matches is a
 *   no-op with an attribution stamp, not a wrong write.
 */
export async function fitAdjustedReturnTeaching(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<{ personId: string; kind: SizedRentalKind; size: string } | null> {
  const [row] = await db
    .select({
      personId: bookings.personId,
      gearKind: gearItems.kind,
      size: gearItems.size,
    })
    .from(gearReservations)
    .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.returnOutcome, "fit_adjusted"),
        isNotNull(gearReservations.returnedAt),
        isNotNull(gearItems.size),
        liveGearItem(),
      ),
    )
    .limit(1);
  if (!row) return null;
  const kind = sizedRentalKindOfGearKind(row.gearKind);
  const size = row.size?.trim();
  if (!kind || !size) return null;
  return { personId: row.personId, kind, size };
}

export async function listOverdueGearReservations(
  db: AppDb,
  shopId: string,
  overdueAsOf: CalendarDate,
): Promise<GearReturnRow[]> {
  return listReturnRows(db, shopId, lt(gearReservations.reservedUntil, overdueAsOf));
}

async function listReturnRows(
  db: AppDb,
  shopId: string,
  windowFilter: SQL,
): Promise<GearReturnRow[]> {
  return (
    db
      .select({
        reservationId: gearReservations.id,
        gearItemId: gearReservations.gearItemId,
        kind: gearItems.kind,
        label: gearItems.label,
        size: gearItems.size,
        reservedFrom: gearReservations.reservedFrom,
        reservedUntil: gearReservations.reservedUntil,
        checkedOutAt: gearReservations.checkedOutAt,
        personId: people.id,
        personName: people.fullName,
        tripTitle: trips.title,
      })
      .from(gearReservations)
      // Every join carries the shop as well, as defense-in-depth: today the
      // reservation writer proves the rows share a shop, and this keeps a
      // future mismatched row from ever rendering another tenant's words here.
      .innerJoin(
        gearItems,
        and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, shopId)),
      )
      // Counter rentals too: a unit lent across the counter is due back and
      // goes overdue exactly like one that rode a boat.
      .leftJoin(
        bookings,
        and(eq(bookings.id, gearReservations.bookingId), eq(bookings.shopId, shopId)),
      )
      .innerJoin(people, and(eq(people.id, reservationHolder()), eq(people.shopId, shopId)))
      .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
      .where(
        and(
          eq(gearReservations.shopId, shopId),
          openGearReservation(),
          liveGearItem(),
          windowFilter,
        ),
      )
      .orderBy(asc(gearReservations.reservedUntil), asc(gearItems.label))
  );
}

/** One unit that went out on a departure and has not come home yet. */
export type TripUnitToCheckIn = {
  reservationId: string;
  gearItemId: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  bookingId: string;
  personName: string;
};

/**
 * **Kit comes back by boat, not by date** (fifth-loop ideas, item 5).
 *
 * Every unit handed over for a seat on this departure that is still out: the
 * Gear tab's "Back from the boat" list once the boat is home. The register's
 * due-back panel reads by date, and a unit on a two-day reservation would not
 * reach it until tomorrow, by which time the next diver has it.
 *
 * Only units that left (`checked_out_at`): a unit still on the wall never went
 * to sea, and "Back" on it would record a return that never happened; its row
 * on the packing list keeps "Release". A cancelled seat's unit is listed too,
 * since it is out whatever happened to the booking.
 */
export async function listTripUnitsToCheckIn(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripUnitToCheckIn[]> {
  return db
    .select({
      reservationId: gearReservations.id,
      gearItemId: gearReservations.gearItemId,
      kind: gearItems.kind,
      label: gearItems.label,
      size: gearItems.size,
      bookingId: bookings.id,
      personName: people.fullName,
    })
    .from(gearReservations)
    .innerJoin(
      bookings,
      and(eq(bookings.id, gearReservations.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(
      gearItems,
      and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, shopId)),
    )
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNotNull(gearReservations.checkedOutAt),
        openGearReservation(),
        liveGearItem(),
        liveTrip(),
      ),
    )
    .orderBy(asc(people.fullName), asc(gearItems.kind), asc(gearItems.label));
}

/** The two answers a unit coming off the boat takes, one at a time. */
export const TRIP_UNIT_RETURN_OUTCOMES = ["all_good", "service_concern"] as const;
export type TripUnitReturnOutcome = (typeof TRIP_UNIT_RETURN_OUTCOMES)[number];

/**
 * **One unit back from the boat** (fifth-loop ideas, item 5): "Back", or "Back
 * with a problem" and the words, which is a `service_concern` return, the
 * flag `serviceConcernStillOpen` keeps on the unit until a technician answers
 * it. It pulls nothing to the bench: that stays the set pane's opt-in tick.
 *
 * Scoped by the departure as well as the shop: the reservation must hold a
 * seat on `tripId` and have gone out, so a replayed or forged id from another
 * departure, a counter rental, or a unit never handed over closes nothing.
 */
export async function returnTripGearUnit(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    reservationId: string;
    outcome: TripUnitReturnOutcome;
    note?: string;
  },
): Promise<GearReservationActionOutcome> {
  const note = optional(input.note);
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const onThisDeparture = db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, input.shopId), eq(bookings.tripId, input.tripId)));
  const [returned] = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        inArray(gearReservations.bookingId, onThisDeparture),
        isNotNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    )
    .returning({ id: gearReservations.id });
  return returned ? { ok: true } : { ok: false, reason: "not_found" };
}
