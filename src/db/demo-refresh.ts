import { and, eq } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import { shops } from "./schema";
import { resetDemoSchedule } from "./seed";
import { upcomingScheduleRange } from "./trips";

/**
 * The keeper of the canonical demo shop's schedule.
 *
 * Every date in the demo is anchored to the instant it was seeded
 * (`src/db/seed-clock.ts`): one boat sails "today", the rest of the board runs
 * about two months out, and the cards and history behind them are dated
 * relative to the same moment. That seed runs **once**, on the first cold start
 * against a fresh database — `isDemoShopSeeded` short-circuits every start after
 * it (`src/db/client.ts`) — and nothing has ever moved those dates again.
 *
 * So the demo has a shelf life. Roughly two months after a database is created,
 * the last seeded departure sails, `upcomingScheduleRange` comes back empty, and
 * `/s/blue-mantis` renders "No trips on the books yet" — which is where the
 * homepage's "See a diver's booking page" link lands a visitor (`src/app/page.tsx`,
 * `scheduleAttributionHref`). The staff half of the demo never showed this
 * because "Try the live demo" mints a *fresh* shop per visitor (ADR
 * 20260724-per-visitor-demo-shops); only the canonical fixture ages, and it is
 * the one a marketing page points the public at.
 *
 * This is the pass that keeps that promise true: when the board has run down to
 * less than {@link DEMO_SCHEDULE_MIN_RUNWAY_DAYS} of departures, restore the
 * whole demo playground against today's clock. See ADR
 * 20260812-demo-schedule-keeper.
 *
 * It is deliberately **not** re-exported from `@/db/seed` the way the demo
 * lifecycle helpers are: it imports `resetDemoSchedule` from there, and
 * re-exporting it back would close an import cycle.
 */

/**
 * How little of the board may be left before a pass restores it.
 *
 * Not "is there a boat today?" — that is true only on the day of a reseed, so
 * it would wipe and rebuild a shared, publicly bookable shop every night for a
 * board a diver has no complaint about. Not "is it empty?" either: by then the
 * schedule a visitor came to look at is already gone. Three weeks of remaining
 * departures is the point where the demo still looks like a working dive shop
 * and there is plenty of room to act before it doesn't — with the daily pass,
 * the restore happens the day the board crosses that line.
 */
export const DEMO_SCHEDULE_MIN_RUNWAY_DAYS = 21;

export type DemoScheduleRefresh = {
  /** False when no canonical demo shop exists — a database seeded around one, not an error. */
  found: boolean;
  /** Days between `now` and the furthest-out departure on the board; 0 when none is left. */
  runwayDays: number | null;
  /** Whether this pass restored the playground. */
  refreshed: boolean;
};

/**
 * Restore the canonical demo shop's schedule if it has nearly run out.
 *
 * Idempotent and cheap on the days it does nothing: one indexed aggregate over
 * the shop's upcoming trips, and no write at all. When it does act, the restore
 * is `resetDemoSchedule` — the same operation the in-demo "Reset demo shop"
 * button and the e2e fixture already run — inside one transaction, so a failure
 * part-way through leaves the demo as it was rather than half-wiped.
 *
 * `{ history: true }`, matching the production seed's own default
 * (`seedDemoSchedule` seeds history unless told not to): the trailing quarter of
 * sailed trips is what gives the demo's reporting something to report, and a
 * restore that dropped it would quietly hollow out the demo it is protecting.
 *
 * The shop is matched on `isDemo` as well as its slug, so this can never touch a
 * real tenant even if `DEMO_SHOP_SLUG` were ever repointed — the same guard
 * `/api/test/reset` makes.
 */
export async function refreshCanonicalDemoSchedule(
  db: AppDb,
  opts: { now?: Date; minRunwayDays?: number } = {},
): Promise<DemoScheduleRefresh> {
  const now = opts.now ?? nowDate();
  const minRunwayDays = opts.minRunwayDays ?? DEMO_SCHEDULE_MIN_RUNWAY_DAYS;

  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true)))
    .limit(1);
  if (!shop) return { found: false, runwayDays: null, refreshed: false };

  // The furthest-out departure, not the soonest: what is being measured is how
  // much board is left, and a shop whose next boat is tomorrow and whose last is
  // tomorrow has none.
  const { last } = await upcomingScheduleRange(db, shop.id, now);
  const runwayDays = last ? Math.floor((last.getTime() - now.getTime()) / DAY_MS) : 0;
  if (runwayDays >= minRunwayDays) return { found: true, runwayDays, refreshed: false };

  await db.transaction(async (tx) => {
    await resetDemoSchedule(tx, shop.id, { history: true });
  });
  return { found: true, runwayDays, refreshed: true };
}
