/**
 * Gear: what is due back, overdue, or came home fit-adjusted. Imported
 * through the `./gear` barrel.
 */
import { and, asc, eq, gte, isNotNull, lt, type SQL } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import type { GearItemKind } from "@/lib/gear";
import {
  SIZED_RENTAL_FIT_COLUMN,
  type SizedRentalKind,
  sizedRentalKindOfGearKind,
} from "@/lib/rentals";
import type { AppDb } from "./client";
import { liveGearItem, openGearReservation, reservationHolder } from "./gear-shared";
import { bookings, gearItems, gearReservations, people, rentalFitProfiles, trips } from "./schema";

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
