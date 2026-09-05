import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { hasSailed } from "@/lib/trips";
import { isCompletedWaiverCurrent } from "@/lib/waivers";
import { type DbExecutor, queryAll } from "./client";
import type { PaymentStatus, WaiverRecord } from "./schema";
import {
  bookingPayments,
  bookings,
  people,
  shops,
  trips,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * **The shop's first booking, while it is still the only one.**
 *
 * The staff side's once-in-a-shop's-life coral moment (ADR
 * 20260827-first-light, decision 6; the coral budget's "the home, once ever"
 * row in ADR 20260827-clearwater-surface-language, decision 11). Condition-
 * derived and transient — no column, no seen-flag, nothing to acknowledge, and
 * the moment ends by itself.
 */
export type FirstBooking = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  diverName: string;
  priceCents: number | null;
  currency: string;
  paymentStatus: PaymentStatus | null;
  paymentAmountCents: number | null;
  paymentCurrency: string | null;
  waiverSigned: boolean;
};

/** Statuses a booking that is still standing can be in. */
const LIVE_BOOKING_STATUSES: readonly string[] = ["booked", "checked_in"];

/**
 * Has this shop taken exactly one booking, ever, and is that diver's departure
 * still ahead?
 *
 * Three clauses, each load-bearing:
 *
 * - **Exactly one booking has ever existed for this shop** — the whole row set,
 *   cancellations included, not "one *live* booking". "Your first booking" is a
 *   claim about the shop's history, and a shop on its third diver after two
 *   cancellations has one live booking and nothing to celebrate. `limit 2` is
 *   the whole test, and it is why this costs the same on a shop with four
 *   thousand bookings as on a shop with one.
 * - **That booking is still live.** A first booking cancelled before the boat
 *   left is not a moment. `no_show` is unreachable here — it is marked after a
 *   departure has sailed, which the next clause already excludes.
 * - **Its departure has not gone**, carrying the standing one-hour
 *   late-arrival buffer every "has it sailed" question in this app carries, and
 *   a soft-deleted departure takes its booking's moment with it. (The join
 *   below reads `trips.deleted_at` rather than filtering on it, deliberately: a
 *   deleted departure's booking still counts toward "is there a second?", and
 *   filtering it out in SQL would resurrect the moment for a shop that had
 *   already moved past it.)
 *
 * **A walk-in counts.** A staffer seating someone at the counter writes an
 * ordinary `bookings` row, and that is still the first booking this shop ever
 * took — the moment is about the shop's first diver, not the door they came
 * through. **Imported history never fires it**: prior visits land in
 * `prior_visits`, a table this reader cannot see, so a shop that migrated ten
 * years of divers on Monday and takes its first DiveDay booking on Tuesday
 * still gets the moment.
 */
export async function shopFirstBooking(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<FirstBooking | null> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      status: bookings.status,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      tripDeletedAt: trips.deletedAt,
      diverName: people.fullName,
      priceCents: trips.priceCents,
      currency: shops.currency,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.shopId, shopId))
    .orderBy(asc(bookings.createdAt))
    .limit(2);

  const [only] = rows;
  if (rows.length !== 1 || !only) return null;
  if (!LIVE_BOOKING_STATUSES.includes(only.status)) return null;
  if (only.tripDeletedAt !== null) return null;
  if (hasSailed(only.startsAt, now)) return null;

  let paymentRows: { status: PaymentStatus; amountCents: number | null; currency: string }[] = [];
  let templateRows: { materialGeneration: number }[] = [];
  let waiverRows: WaiverRecord[] = [];
  [paymentRows, templateRows, waiverRows] = await queryAll(db, [
    () =>
      db
        .select({
          status: bookingPayments.status,
          amountCents: bookingPayments.amountCents,
          currency: bookingPayments.currency,
        })
        .from(bookingPayments)
        .where(
          and(eq(bookingPayments.shopId, shopId), eq(bookingPayments.bookingId, only.bookingId)),
        )
        .limit(1),
    () =>
      db
        .select({ materialGeneration: waiverTemplates.materialGeneration })
        .from(waiverTemplates)
        .where(and(eq(waiverTemplates.shopId, shopId), isNull(waiverTemplates.deletedAt)))
        .orderBy(desc(waiverTemplates.version))
        .limit(1),
    () =>
      db
        .select()
        .from(waiverRecords)
        .where(
          and(
            eq(waiverRecords.shopId, shopId),
            eq(waiverRecords.bookingId, only.bookingId),
            eq(waiverRecords.status, "completed"),
          ),
        )
        .orderBy(desc(waiverRecords.createdAt))
        .limit(1),
  ]);
  const payment = paymentRows[0];
  const waiver = waiverRows[0];
  const currentTemplateGeneration = templateRows[0]?.materialGeneration ?? null;

  return {
    bookingId: only.bookingId,
    tripId: only.tripId,
    tripTitle: only.tripTitle,
    startsAt: only.startsAt,
    diverName: only.diverName,
    priceCents: only.priceCents,
    currency: only.currency,
    paymentStatus: payment?.status ?? null,
    paymentAmountCents: payment?.amountCents ?? null,
    paymentCurrency: payment?.currency ?? null,
    waiverSigned: waiver ? isCompletedWaiverCurrent(waiver, currentTemplateGeneration, now) : false,
  };
}
