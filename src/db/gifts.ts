import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { listDepartureBoardedByTrip } from "./manifests";
import { bookingGifts, bookingPayments, bookings, shops, trips, waiverRecords } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **A seat one person bought for another** (ADR 20260908-one-hand, decision 6,
 * lever W; owner's call (l)).
 *
 * A gift is a booking. Everything a booking has is already true of it — the
 * capacity rule, readiness, the waiver, the blow-out's refund — so there is no
 * gift *transaction* here, only the fact of who bought it and the two reads
 * that fact earns: the giver's own page and the till's sentence.
 *
 * **What a giver may know is the whole subject of this file.** Four facts:
 * claimed, waiver signed, aboard, and the money. Not the receiver's
 * certification, not their medical answers, not their contact details, not
 * anything they later tell the shop. `giverGiftView` returns exactly that shape
 * and `gifts.test.ts` asserts it by key, so widening it is a test failure
 * rather than a review catch.
 */

/** What the giver typed, and the seat it bought. */
export type GiftRecord = {
  bookingId: string;
  shopId: string;
  giverName: string;
  giverEmail: string;
  receiverName: string;
  message: string | null;
};

/**
 * Record the giver on a freshly-created booking. Inside the caller's
 * transaction: a gift booking without its giver is a seat nobody can be told
 * about and nobody can be refunded to by name.
 */
export async function recordGift(
  tx: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    giverName: string;
    giverEmail: string;
    receiverName: string;
    message?: string | null;
  },
): Promise<void> {
  await tx.insert(bookingGifts).values({
    shopId: input.shopId,
    bookingId: input.bookingId,
    giverName: input.giverName,
    giverEmail: input.giverEmail,
    receiverName: input.receiverName,
    message: input.message?.trim() || null,
  });
}

/** The gift on this seat, or null when the seat was bought by whoever is diving. */
export async function giftForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<GiftRecord | null> {
  const [row] = await db
    .select()
    .from(bookingGifts)
    .where(and(eq(bookingGifts.shopId, shopId), eq(bookingGifts.bookingId, bookingId)))
    .limit(1);
  return row
    ? {
        bookingId: row.bookingId,
        shopId: row.shopId,
        giverName: row.giverName,
        giverEmail: row.giverEmail,
        receiverName: row.receiverName,
        message: row.message,
      }
    : null;
}

/**
 * Which of these seats were gifts, and who gave each — for a staff list that
 * has already read its rows and wants one more clause in the sentence. One
 * query for the page, never one per row.
 */
export async function giftGiversByBooking(
  db: DbExecutor,
  shopId: string,
  bookingIds: string[],
): Promise<Map<string, string>> {
  const givers = new Map<string, string>();
  if (bookingIds.length === 0) return givers;
  const rows = await db
    .select({ bookingId: bookingGifts.bookingId, giverName: bookingGifts.giverName })
    .from(bookingGifts)
    .where(and(eq(bookingGifts.shopId, shopId), inArray(bookingGifts.bookingId, bookingIds)));
  for (const row of rows) givers.set(row.bookingId, row.giverName);
  return givers;
}

/**
 * **Every fact the giver's page renders, and no other.**
 *
 * Keyed by booking rather than by shop: the caller has verified a signed gift
 * token (`src/lib/gift-links.ts`) and holds a booking id and nothing else, so
 * the shop is read *from* the booking rather than checked against a claim the
 * bearer made.
 *
 * Null for a seat with no gift on it — a bearer whose token verifies against an
 * ordinary booking learns the same nothing as one whose token is junk.
 */
export type GiftGiverView = {
  shopId: string;
  shopName: string;
  shopSlug: string;
  defaultLocale: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  /** What makes another departure the same gift — see the giver's blow-out door. */
  courseId: string | null;
  diveSiteId: string | null;
  /** The name the giver typed, never the diver's own record. */
  receiverName: string;
  giverName: string;
  message: string | null;
  /** The departure was called off; the page carries the refund sentence and one door. */
  departureCancelled: boolean;
  /** Row one. Null until the receiver claims the seat. */
  claimedAt: Date | null;
  /** Row two. Null until they sign; never *which* waiver or what is on it. */
  waiverSignedAt: Date | null;
  /** Row three, and only ever a boolean: the roll call's own boarding, on the day. */
  aboard: boolean;
  /** Row four. Null when nothing was ever captured for this seat. */
  payment: { status: string; amountCents: number | null; currency: string } | null;
};

export async function giverGiftView(
  db: AppDb,
  bookingId: string,
  now: Date = nowDate(),
): Promise<GiftGiverView | null> {
  const [row] = await db
    .select({ gift: bookingGifts, booking: bookings, trip: trips, shop: shops })
    .from(bookingGifts)
    .innerJoin(bookings, eq(bookings.id, bookingGifts.bookingId))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .innerJoin(shops, eq(shops.id, bookingGifts.shopId))
    .where(eq(bookingGifts.bookingId, bookingId))
    .limit(1);
  if (!row) return null;
  // Defence in depth: the gift and its booking are written in one transaction,
  // so they can only disagree if something else went wrong — and a giver must
  // never be answered off a seat that is not the one they bought.
  if (row.booking.shopId !== row.gift.shopId) return null;

  const [waiver] = await db
    .select({ signedAt: waiverRecords.signedAt })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, row.gift.shopId),
        eq(waiverRecords.bookingId, bookingId),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .limit(1);

  const payment = await db
    .select({
      status: bookingPayments.status,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency,
    })
    .from(bookingPayments)
    .where(
      and(eq(bookingPayments.shopId, row.gift.shopId), eq(bookingPayments.bookingId, bookingId)),
    )
    .limit(1);

  // The one boarding definition, shared with the manifest and the counter
  // (`listDepartureBoardedByTrip`) rather than a second read of the same
  // events. Only ever asked for on the day: before it, "aboard" is a question
  // about a boat that has not sailed.
  const sailed = row.trip.startsAt <= now;
  const aboard = sailed
    ? (
        (await listDepartureBoardedByTrip(db, row.gift.shopId, [row.trip.id])).get(row.trip.id) ??
        new Set<string>()
      ).has(bookingId)
    : false;

  return {
    shopId: row.shop.id,
    shopName: row.shop.name,
    shopSlug: row.shop.slug,
    defaultLocale: row.shop.defaultLocale,
    timezone: row.shop.timezone,
    contactEmail: row.shop.contactEmail,
    contactPhone: row.shop.contactPhone,
    tripId: row.trip.id,
    tripTitle: row.trip.title,
    startsAt: row.trip.startsAt,
    endsAt: row.trip.endsAt,
    courseId: row.trip.courseId,
    diveSiteId: row.trip.diveSiteId,
    receiverName: row.gift.receiverName,
    giverName: row.gift.giverName,
    message: row.gift.message,
    departureCancelled: row.trip.status === "cancelled",
    claimedAt: row.booking.claimedAt,
    waiverSignedAt: waiver?.signedAt ?? null,
    aboard,
    payment: payment[0]
      ? {
          status: payment[0].status,
          amountCents: payment[0].amountCents,
          currency: payment[0].currency,
        }
      : null,
  };
}

/** Gifts given this month, and how many of them have been claimed. */
export type GiftMonthCounts = { given: number; claimed: number };

/**
 * The month's two gift figures for Reports, counted on the same basis as every
 * other aggregate on that page: seats on this month's live departures.
 * A cancelled seat is not a gift the shop gave.
 */
export async function giftCountsForWindow(
  db: DbExecutor,
  shopId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<GiftMonthCounts> {
  const [row] = await db
    .select({
      given: sql<number>`count(*)`,
      claimed: sql<number>`count(${bookings.claimedAt})`,
    })
    .from(bookingGifts)
    .innerJoin(bookings, eq(bookings.id, bookingGifts.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        liveTrip(),
        eq(bookingGifts.shopId, shopId),
        sql`${trips.startsAt} >= ${windowStart} and ${trips.startsAt} < ${windowEnd}`,
        sql`${bookings.status} <> 'cancelled'`,
      ),
    );
  return { given: Number(row?.given ?? 0), claimed: Number(row?.claimed ?? 0) };
}
