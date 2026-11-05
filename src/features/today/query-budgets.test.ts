import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { people, personRoles } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { countingShopContext } from "@/test/query-count";
import { getShopHome } from "./index";

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
 * below says what to ask first.
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
 * 65 → 111 (issue #2757): not a new query. The ceiling used to watch `getTodayWork`
 * alone; it now watches the page's whole reader, `getShopHome` — the first wave (drafts,
 * money gate, readiness, arrivals, closeout, counts, season scale), the queue and
 * tomorrow's cards, the closing reads, the day's money — which is what the page sends.
 * 111 → 112 (loop 5, row 6): the crew's thanks beside the tips line (`crew-thanks.ts`), one
 * statement in the day's money (`day-money.ts`), for the crew member's own Today.
 */
const TODAY_QUERY_CEILING = 112;

/** The seeded shop's owner: the reader whose gates open every door on the home. */
async function seededOwner(ctx: Awaited<ReturnType<typeof countingShopContext>>) {
  const [owner] = await ctx.uncounted
    .select({ personId: people.id })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("the seeded shop has no owner");
  return owner.personId;
}

describe("what the assembly readers cost", () => {
  /**
   * The shop home, which is the one surface every staff session opens first
   * and the one whose reader composes the most: today's departures, their
   * rosters, the desk work, the stuck-payment and unfinished-deletion mirrors.
   *
   * A ceiling rather than an invariance check, because its fan-out is bounded
   * by a *window* — today and the next few days — rather than by anything a
   * caller passes, so there is no size to vary. The number is deliberately
   * loose: this is not a ratchet to be re-banked, it is a tripwire for someone
   * adding a twenty-first query to the page that has to paint instantly. If it
   * fails, the question to ask is not "what should the number be" but "what did
   * this change add to the first screen a shop sees every morning".
   */
  it("assembles the whole shop home under a ceiling", async () => {
    const ctx = await countingShopContext();
    const personId = await seededOwner(ctx);
    ctx.reset();
    const home = await getShopHome(ctx.db, ctx.shop, {
      shopSlug: ctx.shop.slug,
      personId,
      roles: ["owner"],
      now: nowDate(),
      arrivalQuery: "",
      orientationRole: null,
      t: staffTranslator("en-US"),
      locale: "en-US",
    });
    expect(home.work).toBeTruthy();

    const used = ctx.count();
    expect(
      used,
      `the shop home sent ${used} queries; see this test's comment before raising the ceiling`,
    ).toBeLessThanOrEqual(TODAY_QUERY_CEILING);
  });
});
