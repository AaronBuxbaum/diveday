import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { seededShopContext, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { DEMO_SCHEDULE_MIN_RUNWAY_DAYS, refreshCanonicalDemoSchedule } from "./demo-refresh";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { shops, trips, userAccounts } from "./schema";
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
    expect(result).toEqual({ found: true, runwayDays: 0, refreshed: true });

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

  it("does nothing on a database with no canonical demo shop", async () => {
    const db = await unseededTestDb();

    expect(await refreshCanonicalDemoSchedule(db)).toEqual({
      found: false,
      runwayDays: null,
      refreshed: false,
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

    expect(result).toEqual({ found: false, runwayDays: null, refreshed: false });
    expect((await upcomingTripsWithCounts(db, shop.id)).map((trip) => trip.id)).toEqual(
      before.map((trip) => trip.id),
    );
  });
});
