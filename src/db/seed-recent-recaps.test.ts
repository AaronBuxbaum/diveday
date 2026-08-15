import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { summarizeMonth } from "@/lib/reporting";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { refreshCanonicalDemoSchedule } from "./demo-refresh";
import { getMonthlyReport } from "./reporting";
import { bookings, tips, tripReviews, trips } from "./schema";
import { seedRecentRecaps } from "./seed-recent-recaps";

/**
 * Slide the whole board — history included — `days` into the past, which is
 * exactly what the passage of time does to a demo whose dates are pinned to the
 * instant it was seeded. Twenty days on, the trips filling the current month are
 * the ones that were *upcoming* when the seed ran, and those carry no tip and no
 * review: `seedHistory` only ever wrote recaps onto departures that had already
 * sailed by the time it ran.
 *
 * Twenty is chosen to be well inside the demo's six-week restore cycle — this is
 * the state the canonical demo spends most of its life in, not an edge case.
 */
async function ageTheDemo(db: AppDb, shopId: string, days = 20): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({ startsAt: sql`${trips.startsAt} - ${shift}`, endsAt: sql`${trips.endsAt} - ${shift}` })
    .where(eq(trips.shopId, shopId));
}

/** The shop-local calendar month `now` falls in, as the reports page computes it. */
function monthWindow(timeZone: string, now = nowDate()): { start: Date; end: Date } {
  const wall = utcToWallTime(now, timeZone);
  const start = wallTimeToUtc(
    { year: wall.year, month: wall.month, day: 1, hour: 0, minute: 0 },
    timeZone,
  );
  const end = wallTimeToUtc(
    {
      year: wall.month === 12 ? wall.year + 1 : wall.year,
      month: wall.month === 12 ? 1 : wall.month + 1,
      day: 1,
      hour: 0,
      minute: 0,
    },
    timeZone,
  );
  return { start, end };
}

async function publishedReviewsInWindow(
  db: AppDb,
  shopId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(tripReviews)
    .innerJoin(trips, eq(trips.id, tripReviews.tripId))
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        gte(trips.startsAt, start),
        lt(trips.startsAt, end),
      ),
    );
  return row?.total ?? 0;
}

/** Every tip this shop holds, with the departure it was left on. */
async function tipsWithDeparture(db: AppDb, shopId: string) {
  return db
    .select({ status: tips.status, startsAt: trips.startsAt })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(tips.shopId, shopId));
}

describe("seedRecentRecaps", () => {
  it("refills a month whose tips and reviews have aged out from under the seed", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);
    const { start, end } = monthWindow(shop.timezone);

    // The regression: a full month on every other figure, and nothing at all on
    // the two the post-trip recap link writes.
    const before = summarizeMonth(await getMonthlyReport(db, shop.id, start, end));
    expect(before.tripCount).toBeGreaterThan(0);
    expect(before.seatsBooked).toBeGreaterThan(0);
    expect(before.tipCount).toBe(0);
    expect(before.tipsCents).toBe(0);
    expect(await publishedReviewsInWindow(db, shop.id, start, end)).toBe(0);

    const written = await seedRecentRecaps(db, shop.id);
    expect(written.tips).toBeGreaterThan(0);
    expect(written.reviews).toBeGreaterThan(0);

    const after = summarizeMonth(await getMonthlyReport(db, shop.id, start, end));
    expect(after.tipCount).toBeGreaterThan(0);
    expect(after.tipsCents).toBeGreaterThan(0);
    expect(await publishedReviewsInWindow(db, shop.id, start, end)).toBeGreaterThan(0);
    // Figures it must not move: a tip is its own Stripe session, 100% to the
    // shop, and is never folded into "Revenue collected" (PAY-M2).
    expect(after.revenueCents).toBe(before.revenueCents);
    expect(after.seatsBooked).toBe(before.seatsBooked);
    expect(after.waiverCompletion).toBe(before.waiverCompletion);
  });

  it("leaves a freshly seeded demo exactly as seedHistory wrote it", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const { start, end } = monthWindow(shop.timezone);
    const before = summarizeMonth(await getMonthlyReport(db, shop.id, start, end));
    expect(before.tipCount).toBeGreaterThan(0);

    // The keeper fills an empty month; it never fattens one that reads fine.
    // Every e2e run and every visual baseline sits here — a frozen clock
    // mid-month over a fully recapped month — so a row written from this pass
    // would move pixels nobody asked it to move.
    await expect(seedRecentRecaps(db, shop.id)).resolves.toEqual({ tips: 0, reviews: 0 });
    expect(summarizeMonth(await getMonthlyReport(db, shop.id, start, end))).toEqual(before);
  });

  it("never tips a boat that has not sailed", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);
    const now = nowDate();
    const before = (await tipsWithDeparture(db, shop.id)).length;

    await seedRecentRecaps(db, shop.id, { now });

    const written = await tipsWithDeparture(db, shop.id);
    expect(written.length).toBeGreaterThan(before);
    // A tip on a departure that has not left is not a thin demo, it is a wrong
    // one — and the month's board runs on past the day the pass runs.
    expect(written.filter((row) => row.startsAt >= now)).toEqual([]);
    // Nor does it reach back into a month nobody is looking at.
    const { start } = monthWindow(shop.timezone, now);
    const backfilledBefore = written.filter((row) => row.startsAt < start).length;
    expect(backfilledBefore).toBe(before);
  });

  it("writes settled tips only — a demo month never shows money nobody has", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);
    const { start, end } = monthWindow(shop.timezone);

    await seedRecentRecaps(db, shop.id);

    // `getMonthlyReport` sums `paid` and nothing else, so a pending or expired
    // row would simply vanish from the figure this pass exists to fill.
    const thisMonth = (await tipsWithDeparture(db, shop.id)).filter(
      (row) => row.startsAt >= start && row.startsAt < end,
    );
    expect(thisMonth.length).toBeGreaterThan(0);
    expect(thisMonth.every((row) => row.status === "paid")).toBe(true);
  });

  it("is idempotent — a second pass over the same board writes nothing", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);

    const first = await seedRecentRecaps(db, shop.id);
    expect(first.tips).toBeGreaterThan(0);
    expect(first.reviews).toBeGreaterThan(0);
    await expect(seedRecentRecaps(db, shop.id)).resolves.toEqual({ tips: 0, reviews: 0 });
  });

  it("leaves the staff moderation queue exactly as it found it", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);
    const awaiting = async () => {
      const [row] = await db
        .select({ total: count() })
        .from(tripReviews)
        .where(and(eq(tripReviews.shopId, shop.id), eq(tripReviews.isPublished, false)));
      return row?.total ?? 0;
    };
    const before = await awaiting();

    await seedRecentRecaps(db, shop.id);

    // Bare ratings only. Words are what the "waiting on you" queue holds, and
    // how much work the demo shop appears to owe is a seeded, exactly-one thing
    // (`seed-history.ts`) — no keeper pass gets to change it.
    expect(await awaiting()).toBe(before);
  });

  it("runs from the daily demo-refresh pass, without a restore", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheDemo(db, shop.id);
    const { start, end } = monthWindow(shop.timezone);
    expect(summarizeMonth(await getMonthlyReport(db, shop.id, start, end)).tipCount).toBe(0);

    // `minRunwayDays: 0` holds the wipe-and-rebuild branch shut, so what is
    // asserted here is the narrow pass rather than a full re-seed doing the work.
    const result = await refreshCanonicalDemoSchedule(db, { minRunwayDays: 0 });
    expect(result.refreshed).toBe(false);

    expect(
      summarizeMonth(await getMonthlyReport(db, shop.id, start, end)).tipCount,
    ).toBeGreaterThan(0);
    expect(await publishedReviewsInWindow(db, shop.id, start, end)).toBeGreaterThan(0);
  });
});
