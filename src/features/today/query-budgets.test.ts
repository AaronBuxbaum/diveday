import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { shopClock } from "@/lib/shop-clock";
import { countingShopContext } from "@/test/query-count";
import { getTodayWork } from "./index";

/**
 * What the assembly readers **cost**, as opposed to what they answer.
 *
 * Every other test in `src/db` asks whether a reader is right. None of them
 * asks how many round trips it took to be right, and that is the one property
 * of these three that degrades silently: an N+1 added to the home spine is
 * correct, typed, green, and slower for every shop in proportion to how busy
 * their day is. The shops it hurts most are the ones with the most departures,
 * which are the ones we least want to be slow for.
 *
 * The assertions here are mostly **invariance**, not budgets: ask for more and
 * the count must not move. See `src/test/query-count.ts` for why that is the
 * assertion worth writing, and where a fixed ceiling still earns its place.
 */

/**
 * The tripwire for the shop home, set well above what the reader sends today so
 * ordinary work never trips it and a loop always does. Raising it is a decision
 * about the first screen of the working day, not a maintenance chore — the test
 * above says what to ask first.
 *
 * 60 → 61 (fifth loop, merged): what it added is the crew's open snags against
 * a boat's checklist (`openSnagsForShop`), one statement in Today's one wave,
 * on top of the desk layer's count of found items waiting to go home.
 * 61 → 62 (merging main, 2026-10-17): main's boat-on-two-departures read
 * (`boatClashesByTrip`, H-20260916-may-one-hull-carry) beside the crew clash, in the same wave.
 * 62 → 64 (merging batch 3): countOpenDateRequests (#2658) and
 * crewAwayAcknowledgedAt (#2678) in Today's wave.
 * 64 → 65 (#3436): every planned dive's site for the departure cards
 * (`plannedSitesByTrip`), one statement in the same wave.
 */
const TODAY_QUERY_CEILING = 65;

describe("what the assembly readers cost", () => {
  it("assembles the whole shop home under a ceiling", async () => {
    const ctx = await countingShopContext();
    ctx.reset();
    const work = await getTodayWork(
      ctx.db,
      ctx.shop.id,
      ctx.shop.slug,
      shopClock(ctx.shop, nowDate()),
    );
    expect(work).toBeTruthy();

    const used = ctx.count();
    expect(
      used,
      `the shop home sent ${used} queries; see this test's comment before raising the ceiling`,
    ).toBeLessThanOrEqual(TODAY_QUERY_CEILING);
  });
});
