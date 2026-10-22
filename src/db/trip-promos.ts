import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { queryAll } from "./query-helpers";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  interests,
  people,
  type TripLastMinutePromo,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/** Every blast sent for one trip, newest first — the staff page's send history. */
export async function listTripLastMinutePromos(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripLastMinutePromo[]> {
  return db
    .select()
    .from(tripLastMinutePromos)
    .where(and(eq(tripLastMinutePromos.shopId, shopId), eq(tripLastMinutePromos.tripId, tripId)))
    .orderBy(desc(tripLastMinutePromos.createdAt));
}

export type TripLastMinutePromoRecipientItem = {
  promoId: string;
  personId: string;
  fullName: string;
  email: string;
  createdAt: Date;
};

/**
 * Returns who has been sent deals for this trip, with their name, email, promoId,
 * and timestamp: the departure rows that carry a deal (`interests.promo_id`), the
 * rows the offer wrote when it went out (ADR 20261017-one-interest-with-a-scope).
 */
export async function listTripLastMinutePromoRecipients(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripLastMinutePromoRecipientItem[]> {
  const rows = await db
    .select({
      promoId: interests.promoId,
      personId: interests.personId,
      fullName: people.fullName,
      email: people.email,
      offeredAt: interests.offeredAt,
    })
    .from(interests)
    .innerJoin(tripLastMinutePromos, eq(tripLastMinutePromos.id, interests.promoId))
    .innerJoin(people, and(eq(people.id, interests.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "departure"),
        eq(tripLastMinutePromos.tripId, tripId),
        // Who the deal went to, not who was merely stamped with it: an offer
        // whose mail never left carries no `offered_at`.
        isNotNull(interests.offeredAt),
      ),
    )
    .orderBy(asc(interests.offeredAt), asc(people.fullName));
  return rows.flatMap((row) =>
    row.promoId && row.personId && row.email && row.offeredAt
      ? [
          {
            promoId: row.promoId,
            personId: row.personId,
            fullName: row.fullName,
            email: row.email,
            createdAt: row.offeredAt,
          },
        ]
      : [],
  );
}

export type OutstandingLastMinutePromo = TripLastMinutePromo & {
  tripTitle: string;
  tripStartsAt: Date;
};

/** How many deals the Promos page's "Trip deals" list shows per page. */
export const TRIP_DEAL_PAGE_SIZE = PAGE_SIZE.list;

export type OutstandingLastMinutePromoPage = {
  deals: OutstandingLastMinutePromo[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * Every `sent`, unexpired last-minute code across the whole shop, soonest to
 * expire first — the shop-wide counterpart to `listTripLastMinutePromos`'s
 * one-trip history. Backs the read-only "Trip deals" section on `/promos`
 * (task 148, UX-persona Lens 17): before this, a live trip-scoped code was
 * only ever visible from the one departure it was sent on, so a code nobody
 * remembered sending kept discounting quietly. `pending`/`failed` rows are
 * excluded — they were never redeemable and showing them here would just be
 * noise the trip's own send history already carries.
 *
 * One page at a time (ordered by expiry, then id for a stable tiebreak), same
 * idiom as `listShopPromoCodes` — offset-paged, so the Promos page's two lists
 * wear the same pager as every other staff list
 * (ADR 20260803-one-pagination-model).
 *
 * `now` bounds the list and so must bound the count too: both halves take the
 * same `scope`, or "page 1 of 3" would count deals that have already expired
 * out of the rows below it.
 */
export async function listOutstandingLastMinutePromos(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
  options: { page?: number; limit?: number } = {},
): Promise<OutstandingLastMinutePromoPage> {
  const scope = and(
    eq(tripLastMinutePromos.shopId, shopId),
    eq(tripLastMinutePromos.status, "sent"),
    gt(tripLastMinutePromos.expiresAt, now),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? TRIP_DEAL_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(tripLastMinutePromos)
        .innerJoin(trips, eq(trips.id, tripLastMinutePromos.tripId))
        .where(and(scope, liveTrip()));
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          promo: tripLastMinutePromos,
          tripTitle: trips.title,
          tripStartsAt: trips.startsAt,
        })
        .from(tripLastMinutePromos)
        .innerJoin(trips, eq(trips.id, tripLastMinutePromos.tripId))
        .where(and(scope, liveTrip()))
        .orderBy(
          asc(tripLastMinutePromos.expiresAt),
          asc(trips.startsAt),
          asc(trips.title),
          asc(tripLastMinutePromos.id),
        )
        .limit(limit)
        .offset(offset),
  });

  return {
    deals: paged.rows.map(({ promo, tripTitle, tripStartsAt }) => ({
      ...promo,
      tripTitle,
      tripStartsAt,
    })),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * Resolves a diver-typed code to a live, unexpired promotion issued for this
 * exact trip — the trip-scoping check that keeps a code from being reused on
 * an unrelated booking (docs ADR 20260727-last-minute-fill-promos). Returns
 * null on anything that doesn't match, rather than distinguishing "wrong
 * code" from "wrong trip" from "expired" — the diver-facing behavior is the
 * same either way (the code just doesn't apply).
 */
export async function getActiveTripPromoByCode(
  db: DbExecutor,
  input: { shopId: string; tripId: string; code: string; now?: Date },
): Promise<TripLastMinutePromo | null> {
  const code = input.code.trim().toUpperCase();
  if (!code) return null;
  const [row] = await db
    .select()
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, input.shopId),
        eq(tripLastMinutePromos.tripId, input.tripId),
        eq(tripLastMinutePromos.code, code),
        eq(tripLastMinutePromos.status, "sent"),
        gt(tripLastMinutePromos.expiresAt, input.now ?? nowDate()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Trip ids among `tripIds` that have never had a `sent` last-minute-deal blast. */
export async function tripIdsNeverSentLastMinuteDeal(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const sent = await db
    .select({ tripId: tripLastMinutePromos.tripId })
    .from(tripLastMinutePromos)
    .where(
      and(
        eq(tripLastMinutePromos.shopId, shopId),
        inArray(tripLastMinutePromos.tripId, tripIds),
        eq(tripLastMinutePromos.status, "sent"),
      ),
    );
  const alreadySent = new Set(sent.map((row) => row.tripId));
  return new Set(tripIds.filter((id) => !alreadySent.has(id)));
}

/**
 * **The departures a last-minute deal suits** (dive-domain review N7): of
 * `tripIds`, the scheduled public boat departures that are not a course
 * session. A half-empty Open Water session, a pool day or a private charter
 * is not an offer a shop makes to its last-minute list, so the Monday email
 * never suggests one.
 */
export async function tripIdsSuitedToADeal(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.id, tripIds),
        eq(trips.status, "scheduled"),
        eq(trips.diveMode, "boat"),
        eq(trips.isPrivate, false),
        isNull(trips.courseId),
        liveTrip(),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** What a last-minute deal sold (fifth loop, item 28). */
export type DealOutcome = { seats: number; seatsCents: number };

/**
 * **What each deal sold**: the seats on completed checkouts that carried the
 * deal's code, and what those checkouts settled for net of tax, Stripe's own
 * figure where it reported one and the asked total otherwise (the basis
 * `getMonthlyReport` recovers deposits on). Without it a deal reads "Sent to 8
 * divers" and stops, and the owner cannot tell a deal that filled a boat from
 * one that discounted divers who were coming anyway.
 */
export async function lastMinuteDealOutcomes(
  db: DbExecutor,
  shopId: string,
  dealIds: readonly string[],
): Promise<Map<string, DealOutcome>> {
  if (dealIds.length === 0) return new Map();
  const [seatRows, moneyRows] = await queryAll(db, [
    () =>
      db
        .select({
          dealId: bookingCheckouts.tripPromoId,
          seats: countDistinct(bookingCheckoutBookings.bookingId),
        })
        .from(bookingCheckouts)
        .innerJoin(
          bookingCheckoutBookings,
          and(
            eq(bookingCheckoutBookings.checkoutId, bookingCheckouts.id),
            eq(bookingCheckoutBookings.shopId, shopId),
          ),
        )
        .where(
          and(
            eq(bookingCheckouts.shopId, shopId),
            eq(bookingCheckouts.status, "completed"),
            inArray(bookingCheckouts.tripPromoId, [...dealIds]),
          ),
        )
        .groupBy(bookingCheckouts.tripPromoId),
    () =>
      db
        .select({
          dealId: bookingCheckouts.tripPromoId,
          cents: sql<string>`coalesce(sum(greatest(coalesce(${bookingCheckouts.settledTotalCents}, ${bookingCheckouts.totalCents}) - coalesce(${bookingCheckouts.taxCents}, 0), 0)), 0)`,
        })
        .from(bookingCheckouts)
        .where(
          and(
            eq(bookingCheckouts.shopId, shopId),
            eq(bookingCheckouts.status, "completed"),
            inArray(bookingCheckouts.tripPromoId, [...dealIds]),
          ),
        )
        .groupBy(bookingCheckouts.tripPromoId),
  ]);
  const outcomes = new Map<string, DealOutcome>();
  for (const row of seatRows) {
    if (row.dealId) outcomes.set(row.dealId, { seats: Number(row.seats), seatsCents: 0 });
  }
  for (const row of moneyRows) {
    if (!row.dealId) continue;
    const seen = outcomes.get(row.dealId) ?? { seats: 0, seatsCents: 0 };
    outcomes.set(row.dealId, { ...seen, seatsCents: Number(row.cents) });
  }
  return outcomes;
}
