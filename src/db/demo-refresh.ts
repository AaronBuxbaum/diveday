import { and, asc, eq, gt, gte, isNull, lt } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import { shops, trips } from "./schema";
import { demoTodayDepartureStart } from "./seed-clock";
import { seedRecentRecaps } from "./seed-recent-recaps";
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
 * Three passes keep that promise true, and they are deliberately different sizes
 * because a diver, a staffer and an owner read different halves of the demo. See
 * ADR 20260812-demo-schedule-keeper.
 *
 * 1. **The restore.** When the board has run down to less than
 *    {@link DEMO_SCHEDULE_MIN_RUNWAY_DAYS} of departures, rebuild the whole demo
 *    playground against today's clock. This is what keeps the diver-facing
 *    schedule the homepage links to from emptying.
 * 2. **The today nudge** ({@link ensureDemoSailsToday}). A board three weeks deep
 *    satisfies a diver and still leaves the staff surfaces looking at an empty
 *    day, because "today" is what staff read. When nothing sails today, move the
 *    nearest upcoming departure onto today's slot — one row, no wipe.
 * 3. **The month's recaps** (`seedRecentRecaps`, `src/db/seed-recent-recaps.ts`).
 *    An owner reads the month just gone, and every tip and review the demo owns
 *    is dated relative to the seed instant — so between restores the current
 *    month carries none of either and "How's your month" reads "Tips $0" beside
 *    a full trips table. Writes them onto the departures that have already
 *    sailed this month, and only when the month has none.
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

/**
 * What the narrow today pass did.
 *
 * - `already` — a departure was already on today's board; nothing was touched.
 * - `moved` — the nearest upcoming departure was pulled onto today's slot.
 * - `restored` — the full restore ran, which seeds a boat sailing today itself.
 * - `no_candidate` — nothing sails today and nothing upcoming could be moved.
 */
export type DemoTodayOutcome = "already" | "moved" | "restored" | "no_candidate";

export type DemoScheduleRefresh = {
  /** False when no canonical demo shop exists — a database seeded around one, not an error. */
  found: boolean;
  /** Days between `now` and the furthest-out departure on the board; 0 when none is left. */
  runwayDays: number | null;
  /** Whether this pass restored the playground. */
  refreshed: boolean;
  /** What it took to keep a boat on today's board. Null when there is no demo shop. */
  today: DemoTodayOutcome | null;
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
    .select({ id: shops.id, timezone: shops.timezone })
    .from(shops)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true)))
    .limit(1);
  if (!shop) return { found: false, runwayDays: null, refreshed: false, today: null };

  // The furthest-out departure, not the soonest: what is being measured is how
  // much board is left, and a shop whose next boat is tomorrow and whose last is
  // tomorrow has none.
  const { last } = await upcomingScheduleRange(db, shop.id, now);
  const runwayDays = last ? Math.floor((last.getTime() - now.getTime()) / DAY_MS) : 0;
  if (runwayDays < minRunwayDays) {
    // Deferred for the same reason as `client.ts`'s `seedIfEmpty`: a static
    // edge to `./seed` from a module this widely imported drags the schema and
    // the course templates into most of the app's route graphs.
    const { resetDemoSchedule } = await import("./seed");
    await db.transaction(async (tx) => {
      await resetDemoSchedule(tx, shop.id, { history: true });
    });
    // A restore reseeds from `demoTodayDepartureStart`, so today has a boat by
    // construction — the narrow pass below would find one and do nothing.
    return { found: true, runwayDays, refreshed: true, today: "restored" };
  }

  const today = await ensureDemoSailsToday(db, shop.id, shop.timezone, now);
  // The third pass, and the same gap in a different column: a diver looks at
  // what is coming up, staff look at today, and an *owner* looks at the month
  // just gone. Every tip and every review the demo owns is dated relative to the
  // seed instant, so between restores the current month has none of either and
  // "How's your month" reads "Tips $0" beside a full trips table. Writes at most
  // a few dozen rows, and only into a month that carries no recap at all
  // (`seedRecentRecaps`). Deliberately not part of the restore branch above: a
  // restore re-seeds the trailing quarter against today's clock, so the month it
  // leaves behind is already recapped.
  await seedRecentRecaps(db, shop.id, { now });

  return { found: true, runwayDays, refreshed: false, today };
}

/**
 * Keep one boat on the demo's board *today*, without wiping the shop.
 *
 * The restore above is what keeps the diver-facing schedule stocked, and it is
 * the only thing that has ever moved the demo's dates — which leaves a gap the
 * runway threshold cannot close. A diver looks at what is *coming up*, so three
 * weeks of board is a healthy demo to them; staff look at **today**, and between
 * restores (roughly every six weeks) nothing sails today, so `/shop/blue-mantis`'s
 * Today queue, its manifests and its close-out all render an empty day in
 * production (FU-20260812-canonical-demo-has-no-today-between-restores).
 *
 * Lowering `DEMO_SCHEDULE_MIN_RUNWAY_DAYS` was the wrong lever: it reseeds a few
 * thousand rows of a publicly bookable shop — wiping whatever a visitor did — to
 * fix one missing row. This moves the nearest upcoming departure onto today's
 * slot instead and touches nothing else.
 *
 * **The trade-off, stated:** the roster, waivers and crew attached to that trip
 * travel with it, so today's board shows a departure whose story was written for
 * a different day. That is the price of not wiping the shop, and it is cheap
 * next to an empty day: a demo with a full boat on it teaches what DiveDay does,
 * and one with nothing on it teaches nothing.
 *
 * "Today already has one" counts a departure that has already sailed and
 * returned — the invariant is that today's board is not blank, and the shop home
 * (and now its close-out handoff) reads an ended departure as work, not as
 * absence.
 */
export async function ensureDemoSailsToday(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<DemoTodayOutcome> {
  const { from, to } = shopDayBounds(now, timeZone);
  const [sailingToday] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, from),
        lt(trips.startsAt, to),
      ),
    )
    .limit(1);
  if (sailingToday) return "already";

  const [candidate] = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        // Never a series instance. A moved one keeps its `series_occurrence_date`
        // precisely so the nightly roll does not re-fill the slot it left
        // (ADR 20260810-open-ended-recurring-trips), so pulling one onto today
        // would punch a permanent hole in a cadence a shop can see.
        isNull(trips.seriesId),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!candidate) return "no_candidate";

  // Same duration, new start — a two-tank morning stays a two-tank morning
  // rather than becoming a trip that returns before it leaves.
  const startsAt = demoTodayDepartureStart(now, timeZone);
  const endsAt = new Date(
    startsAt.getTime() + (candidate.endsAt.getTime() - candidate.startsAt.getTime()),
  );
  await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, candidate.id));
  return "moved";
}
