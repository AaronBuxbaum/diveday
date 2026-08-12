import { and, asc, eq, gte, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import { seededShopContext, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import {
  DEMO_SCHEDULE_MIN_RUNWAY_DAYS,
  ensureDemoSailsToday,
  refreshCanonicalDemoSchedule,
} from "./demo-refresh";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { shops, tripSeries, trips, userAccounts } from "./schema";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { upcomingScheduleRange, upcomingTripsWithCounts } from "./trips";

/**
 * Age a shop's board by `days`, which is what a real deployment does to itself:
 * the seed's dates were fixed at the instant the database was created and the
 * calendar walked on past them. Shifting the rows back is the same picture as
 * letting the clock move forward, and it keeps every assertion below on one
 * clock — the frozen application clock the seed itself anchors to.
 */
async function ageTheBoard(db: AppDb, shopId: string, days: number): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} - ${shift}`,
      endsAt: sql`${trips.endsAt} - ${shift}`,
    })
    .where(eq(trips.shopId, shopId));
}

/**
 * Push every *upcoming* departure `days` into the future — a healthy schedule
 * with a hole where today should be, which is the state the demo spends most of
 * its six-week cycle in: plenty of departures for a diver to look at, and nothing
 * at all on the day staff actually work.
 *
 * Upcoming only. Shifting the seeded *history* forward as well slides a sailed
 * trip into today, which is exactly the state these tests are trying to create
 * the absence of.
 */
async function pushTheBoardLater(db: AppDb, shopId: string, days: number): Promise<void> {
  const shift = sql.raw(`interval '${days} days'`);
  await db
    .update(trips)
    .set({
      startsAt: sql`${trips.startsAt} + ${shift}`,
      endsAt: sql`${trips.endsAt} + ${shift}`,
    })
    .where(and(eq(trips.shopId, shopId), gte(trips.startsAt, nowDate())));
}

/** Every scheduled departure, oldest first — ids and times, to prove what moved. */
async function board(db: AppDb, shopId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled")))
    .orderBy(asc(trips.startsAt));
}

/** Just the departures still ahead — the pool the today nudge picks from. */
async function upcoming(db: AppDb, shopId: string) {
  return db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, nowDate())),
    )
    .orderBy(asc(trips.startsAt));
}

/** Whether anything sails on the shop's own calendar day containing `now`. */
async function sailsToday(db: AppDb, shopId: string, timeZone: string): Promise<boolean> {
  const { from, to } = shopDayBounds(nowDate(), timeZone);
  const rows = await board(db, shopId);
  return rows.some((trip) => trip.startsAt >= from && trip.startsAt < to);
}

/** Days of departures left on the board, the same measure the pass reads. */
async function runwayDays(db: AppDb, shopId: string): Promise<number> {
  const now = nowDate();
  const { last } = await upcomingScheduleRange(db, shopId, now);
  return last ? Math.floor((last.getTime() - now.getTime()) / DAY_MS) : 0;
}

describe("refreshCanonicalDemoSchedule", () => {
  it("restores a board that has sailed out from under the seed", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const seededRunway = await runwayDays(db, shop.id);

    // The bug this exists for. Every seeded departure is anchored to the moment
    // the database was seeded, that seed runs exactly once, and about two
    // months later the whole board is in the past — so the public schedule the
    // homepage's "See a diver's booking page" link opens says "No trips on the
    // books yet" to every visitor who clicks it.
    await ageTheBoard(db, shop.id, seededRunway + 1);
    expect((await upcomingScheduleRange(db, shop.id)).first).toBeNull();

    const result = await refreshCanonicalDemoSchedule(db);
    expect(result).toEqual({ found: true, runwayDays: 0, refreshed: true, today: "restored" });

    // A board again, and one with real depth to it — not a single boat that
    // will strand the next visitor a day later.
    const { first } = await upcomingScheduleRange(db, shop.id);
    if (!first) throw new Error("expected a restored board to have a next departure");
    expect(await runwayDays(db, shop.id)).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
    // The demo's own promise: a boat sails today, whenever the demo is opened
    // (`demoTodayDepartureStart`).
    expect(first.getTime() - nowDate().getTime()).toBeLessThan(DAY_MS);
  });

  it("leaves the staff and their logins in place while it restores the schedule", async () => {
    // This pass runs unattended against the shop the marketing site points at,
    // so what it must never do is take the demo's sign-ins with it —
    // `resetDemoSchedule` restores only the playground half by design (ADR
    // 20260718-demo-mode), and nothing else here would notice if that changed.
    const { db, shop } = await seededShopContext({ history: true });
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) + 1);

    await refreshCanonicalDemoSchedule(db);

    const accounts = await db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
    expect(accounts).toHaveLength(1);
  });

  it("leaves a board with weeks of departures on it alone", async () => {
    const { db, shop } = await seededShopContext();
    const before = await upcomingTripsWithCounts(db, shop.id);

    const result = await refreshCanonicalDemoSchedule(db);

    expect(result.refreshed).toBe(false);
    // Freshly seeded, so a boat already sails today and the narrow pass has
    // nothing to do either — a healthy demo is touched by neither.
    expect(result.today).toBe("already");
    expect(result.runwayDays).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
    // Not merely "still has trips": the same trips, so a nightly pass over a
    // healthy demo can never churn the shop a visitor is looking at.
    expect((await upcomingTripsWithCounts(db, shop.id)).map((trip) => trip.id)).toEqual(
      before.map((trip) => trip.id),
    );
  });

  it("restores as soon as the board runs below the threshold, not once it is empty", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    // Leave one day less than the threshold demands — still a schedule a diver
    // could book from, which is the point: the demo is restored while it still
    // looks like a working dive shop.
    const target = DEMO_SCHEDULE_MIN_RUNWAY_DAYS - 1;
    await ageTheBoard(db, shop.id, (await runwayDays(db, shop.id)) - target);

    const result = await refreshCanonicalDemoSchedule(db);

    expect(result.refreshed).toBe(true);
    expect(result.runwayDays).toBe(target);
    expect(await runwayDays(db, shop.id)).toBeGreaterThanOrEqual(DEMO_SCHEDULE_MIN_RUNWAY_DAYS);
  });

  it("puts a boat on today's board without wiping a healthy shop", async () => {
    // The gap the runway threshold cannot close: three weeks of upcoming
    // departures is a healthy demo to a *diver*, and staff still open
    // /shop/blue-mantis to an empty day — for about forty days out of every
    // six-week restore cycle.
    const { db, shop } = await seededShopContext({ history: true });
    await pushTheBoardLater(db, shop.id, 4);
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(false);
    const before = await board(db, shop.id);
    const [nearest] = await upcoming(db, shop.id);
    const untouched = before.filter((trip) => trip.id !== nearest.id);

    const result = await refreshCanonicalDemoSchedule(db);

    // Moved, not restored: the whole point is that a publicly bookable shop is
    // not deleted and re-seeded to fix one missing row.
    expect(result.refreshed).toBe(false);
    expect(result.today).toBe("moved");
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(true);

    const after = await board(db, shop.id);
    // The nearest upcoming departure is the one that moved, and it is the *only*
    // thing that moved — every other trip keeps the time it had.
    const movedIds = after
      .filter((trip) => {
        const was = before.find((row) => row.id === trip.id);
        return was && trip.startsAt.getTime() !== was.startsAt.getTime();
      })
      .map((trip) => trip.id);
    expect(movedIds).toEqual([nearest.id]);
    expect(after).toHaveLength(before.length);
    for (const trip of untouched) {
      const now = after.find((row) => row.id === trip.id);
      expect(now?.startsAt).toEqual(trip.startsAt);
      expect(now?.endsAt).toEqual(trip.endsAt);
    }

    // A two-tank morning stays a two-tank morning: same duration, new start.
    const moved = after.find((trip) => trip.id === nearest.id);
    if (!moved) throw new Error("expected the moved trip to still be on the board");
    expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(
      nearest.endsAt.getTime() - nearest.startsAt.getTime(),
    );
  });

  it("leaves a shop that already has a boat today entirely alone", async () => {
    const { db, shop } = await seededShopContext();
    const before = await board(db, shop.id);

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("already");

    expect(await board(db, shop.id)).toEqual(before);
  });

  it("counts a departure that has already come home as today's board", async () => {
    // "Today has a board" is about the day not being blank, not about a boat
    // still being out: the shop home reads an ended departure as work (its
    // close-out handoff keys on exactly that), so a morning trip that is already
    // back must not trigger a second one being dragged onto today.
    const { db, shop } = await seededShopContext();
    const { from } = shopDayBounds(nowDate(), DEMO_SHOP_TIMEZONE);
    const [todaysBoat] = await upcoming(db, shop.id);
    // Park it just after local midnight and give it a short, already-finished run.
    await db
      .update(trips)
      .set({ startsAt: from, endsAt: new Date(from.getTime() + 60 * 60 * 1000) })
      .where(eq(trips.id, todaysBoat.id));
    const before = await board(db, shop.id);

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("already");

    expect(await board(db, shop.id)).toEqual(before);
  });

  it("never drags a recurring instance off its slot", async () => {
    // A moved series instance keeps its `series_occurrence_date` so the nightly
    // roll does not re-fill the date it left (ADR 20260810-open-ended-recurring-trips),
    // so pulling one onto today would punch a permanent hole in a cadence staff
    // can see. The next non-series departure is moved instead.
    const { db, shop } = await seededShopContext({ history: true });
    await pushTheBoardLater(db, shop.id, 4);
    const [nearest, second] = await upcoming(db, shop.id);
    const [series] = await db
      .insert(tripSeries)
      .values({
        shopId: shop.id,
        title: "Standing Saturday charter",
        weekdayMask: 1 << 6,
        anchorDate: "2026-08-01",
        occurrenceCount: 1,
      })
      .returning({ id: tripSeries.id });
    await db
      .update(trips)
      .set({ seriesId: series.id, seriesOccurrenceDate: "2026-08-15" })
      .where(eq(trips.id, nearest.id));

    expect(await ensureDemoSailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe("moved");

    const after = await board(db, shop.id);
    const instance = after.find((trip) => trip.id === nearest.id);
    expect(instance?.startsAt).toEqual(nearest.startsAt);
    const movedTrip = after.find((trip) => trip.id === second.id);
    if (!movedTrip) throw new Error("expected the second departure to still be on the board");
    expect(movedTrip.startsAt.getTime()).not.toBe(second.startsAt.getTime());
    expect(await sailsToday(db, shop.id, DEMO_SHOP_TIMEZONE)).toBe(true);
  });

  it("does nothing on a database with no canonical demo shop", async () => {
    const db = await unseededTestDb();

    expect(await refreshCanonicalDemoSchedule(db)).toEqual({
      found: false,
      runwayDays: null,
      refreshed: false,
      today: null,
    });
  });

  it("refuses to touch the shop if it is not a demo", async () => {
    // The same guard `/api/test/reset` makes, and the one that matters most
    // here: this pass deletes and re-seeds, and it runs unattended in
    // production. `minRunwayDays` is set past any possible board so the only
    // thing that can stop it is the `isDemo` check.
    const { db, shop } = await seededShopContext();
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const before = await upcomingTripsWithCounts(db, shop.id);

    const result = await refreshCanonicalDemoSchedule(db, { minRunwayDays: 10_000 });

    expect(result).toEqual({ found: false, runwayDays: null, refreshed: false, today: null });
    expect((await upcomingTripsWithCounts(db, shop.id)).map((trip) => trip.id)).toEqual(
      before.map((trip) => trip.id),
    );
  });
});
