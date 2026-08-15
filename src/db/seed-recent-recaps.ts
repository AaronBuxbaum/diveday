import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { bookings, shops, tips, tripReviews, trips } from "./schema";

/**
 * The recaps the month you are *reading about* should carry.
 *
 * `seed-history.ts` is the demo's only writer of `tips` and `trip_reviews`, and
 * every trip it writes them onto is dated `daysAgo: 1 … 270` **relative to the
 * instant the seed ran**. That seed runs once (`src/db/client.ts`), so the whole
 * recap corpus is frozen where the calendar left it: the moment the month turns,
 * every settled tip and every published review falls behind the reporting
 * window, and the departures now filling the current month are board trips that
 * were *upcoming* when the seed ran and therefore carry neither.
 *
 * The visible cost is on `/shop/<slug>/reports`, whose default view is the
 * current month. Measured against a demo seeded on 2026-07-21 and read twenty
 * days later, "How's your month" showed 22 trips, 91 bookings, a real revenue
 * figure, a real waiver percentage — and **"Tips $0 · No tips left on this
 * month's trips"**, with the Reviews page's "this month" line at zero beside it.
 * That is the whole of the report "we still have some elements that are not
 * actually seeded (eg. reviews, tips)": nothing is unseeded, it has aged out of
 * the window. The canonical demo spends most of every six-week restore cycle in
 * that state, and a developer's `.pglite` stays in it indefinitely.
 *
 * So this is a **keeper**, not a scenario — the same shape as
 * `ensureDemoSailsToday` (`src/db/demo-refresh.ts`), and deliberately not a line
 * in `seed.ts`'s orchestrator: a seed cannot write a row for a boat that has not
 * sailed yet, which is precisely the row that goes missing later. It runs from
 * the daily demo-refresh pass and writes at most a few dozen rows, wiping
 * nothing.
 *
 * **It only fires on a month that carries none.** Tips are written only when no
 * departure that has already sailed this month holds a settled tip, and reviews
 * only when none holds a review — so a freshly seeded demo (and every e2e run,
 * whose frozen clock sits mid-month over a fully recapped July) is left exactly
 * as `seedHistory` wrote it. It densifies nothing; it fills an empty month.
 *
 * Everything it writes is derived from the candidate's position in a stable
 * ordering — never randomness, never the wall clock beyond the `now` it is
 * handed — so two runs against the same board produce the same rows, and the
 * per-booking skips make a second run a no-op rather than a duplicate.
 */

/** Bookings that count as "on the boat" — the same active set the report sums. */
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;

export type RecentRecapSeed = {
  /** Settled tips written. */
  tips: number;
  /** Published ratings written. */
  reviews: number;
};

type Candidate = {
  bookingId: string;
  tripId: string;
  personId: string;
  startsAt: Date;
};

/**
 * Give this shop's current calendar month the tips and reviews a sailed
 * departure leaves behind, if it has none.
 *
 * Scoped to departures that have **already sailed** (`startsAt < now`) inside
 * the current month in the shop's own timezone — a tip on a boat that has not
 * left is not a thin demo, it is a wrong one. Cancelled departures are excluded
 * for the reason every reporting aggregate excludes them.
 *
 * The caller owns the "is this the demo shop?" question:
 * `refreshCanonicalDemoSchedule` matches on `isDemo` as well as the slug before
 * it gets here, the same guard the restore makes.
 */
export async function seedRecentRecaps(
  db: DbExecutor,
  shopId: string,
  opts: { now?: Date } = {},
): Promise<RecentRecapSeed> {
  const now = opts.now ?? nowDate();

  const [shop] = await db
    .select({ timezone: shops.timezone, currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return { tips: 0, reviews: 0 };

  // The month boundary is the shop's own, exactly as the reports page computes
  // it — a departure at 8pm on the 31st belongs to the month the shop sailed it
  // in, not to whichever month UTC happened to be in at the time.
  const wall = utcToWallTime(now, shop.timezone);
  const monthStart = wallTimeToUtc(
    { year: wall.year, month: wall.month, day: 1, hour: 0, minute: 0 },
    shop.timezone,
  );

  const candidates: Candidate[] = await db
    .select({
      bookingId: bookings.id,
      tripId: trips.id,
      personId: bookings.personId,
      startsAt: trips.startsAt,
    })
    .from(trips)
    .innerJoin(
      bookings,
      and(
        eq(bookings.tripId, trips.id),
        eq(bookings.shopId, shopId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
      ),
    )
    .where(
      and(
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        gte(trips.startsAt, monthStart),
        lt(trips.startsAt, now),
      ),
    )
    // Deterministic: departure order, then booking id, so the index every
    // decision below keys off is the same on every run.
    .orderBy(asc(trips.startsAt), asc(bookings.id));
  if (candidates.length === 0) return { tips: 0, reviews: 0 };

  const bookingIds = candidates.map((row) => row.bookingId);

  // Serial, never `Promise.all`: this can be handed a transaction, and a drizzle
  // transaction is one checked-out client (scripts/check-db-concurrency.mjs).
  const existingTips = await db
    .select({ bookingId: tips.bookingId })
    .from(tips)
    .where(and(eq(tips.shopId, shopId), inArray(tips.bookingId, bookingIds)));
  const existingReviews = await db
    .select({ bookingId: tripReviews.bookingId })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), inArray(tripReviews.bookingId, bookingIds)));

  // The keeper condition. A month that already shows one settled tip is a month
  // whose story is intact — leave it alone rather than fattening it, so the
  // frozen-clock fleet and its visual baselines never see a row from here.
  const tipRows =
    existingTips.length > 0 ? [] : candidates.map(tipRowFor(shopId, shop.currency)).filter(isRow);
  const reviewRows =
    existingReviews.length > 0 ? [] : candidates.map(reviewRowFor(shopId)).filter(isRow);

  if (tipRows.length > 0) await db.insert(tips).values(tipRows);
  if (reviewRows.length > 0) await db.insert(tripReviews).values(reviewRows);

  return { tips: tipRows.length, reviews: reviewRows.length };
}

function isRow<T>(row: T | null): row is T {
  return row !== null;
}

/**
 * A settled tip on most bookings, and none at all on roughly one in seven —
 * tipping is a courtesy, and a boat where every single diver tipped reads as
 * fabricated. Amounts and Stripe references mirror `seed-history.ts`'s: the
 * provider is never contacted, and a tip has never touched the booking-payment
 * gate (ADR 20260726-post-trip-tipping).
 */
function tipRowFor(shopId: string, currency: string) {
  return (row: Candidate, i: number): typeof tips.$inferInsert | null => {
    if (i % 7 === 3) return null;
    // The recap link is tapped once the boat is back in, not at the dock.
    const createdAt = new Date(row.startsAt.getTime() + 3 * HOUR_MS);
    return {
      shopId,
      bookingId: row.bookingId,
      status: "paid" as const,
      stripeAccountId: "acct_demo",
      // Keyed to the booking, so the unique index itself refuses a duplicate
      // even if this ever ran twice against the same board.
      stripeSessionId: `cs_tip_recap_${row.bookingId}`,
      checkoutUrl: null,
      currency,
      amountCents: i % 3 === 0 ? 2_500 : 1_500,
      expiresAt: null,
      completedAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
      createdAt,
    };
  };
}

/**
 * A published rating on every fourth booking, and never a written one. Words
 * are what the staff moderation queue exists to hold, and the demo's "waiting
 * on you" card is a seeded, exactly-one thing (`seed-history.ts`) — a keeper
 * pass has no business changing how much work the shop appears to owe. A bare
 * rating publishes on arrival, which is what these are.
 */
function reviewRowFor(shopId: string) {
  return (row: Candidate, i: number): typeof tripReviews.$inferInsert | null => {
    if (i % 4 !== 0) return null;
    const createdAt = new Date(row.startsAt.getTime() + 6 * HOUR_MS);
    return {
      shopId,
      bookingId: row.bookingId,
      tripId: row.tripId,
      personId: row.personId,
      rating: i % 3 === 0 ? 5 : 4,
      comment: null,
      isPublished: true,
      publishedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  };
}
