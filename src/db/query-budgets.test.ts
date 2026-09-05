import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pagedOrdersByDay } from "@/db/orders";
import { listTripsReadiness } from "@/db/readiness";
import { trips } from "@/db/schema";
import { getTodayWork } from "@/db/today";
import { nowDate } from "@/lib/clock";
import { countingShopContext } from "@/test/query-count";

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
describe("what the assembly readers cost", () => {
  /**
   * The fan-out reader, and the clearest case in the tree: the roster, the
   * manifest and Today all hand it a *list* of departures and it answers for
   * all of them. If it ever answers per departure instead, every one of those
   * three surfaces gets slower on exactly the busy days they exist for.
   *
   * `queryAll` is what makes it one batch, and `queryAll` is also allowed to go
   * sequential inside a transaction (`src/db/client.ts`) — sequential is fine,
   * *per-trip* is not, and only a count can tell those apart.
   */
  it("reads readiness for many departures in the same number of queries as for one", async () => {
    const ctx = await countingShopContext();
    const rows = await ctx.uncounted
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, ctx.shop.id))
      .orderBy(asc(trips.startsAt))
      .limit(4);
    const ids = rows.map((row) => row.id);
    expect(ids.length).toBe(4);

    const counts: number[] = [];
    for (const size of [1, 2, 4]) {
      ctx.reset();
      // Batches, not trips: a departure contributes one per dive it plans, so
      // the length grows with the input without being equal to it. What must
      // *not* grow is the number of round trips that produced them.
      const batches = await listTripsReadiness(ctx.db, ctx.shop.id, ids.slice(0, size));
      expect(batches.length).toBeGreaterThan(0);
      counts.push(ctx.count());
    }

    expect(counts, `one query per departure would read ${counts.join(", ")}`).toEqual([
      counts[0],
      counts[0],
      counts[0],
    ]);
  });

  /**
   * The paged list, where the loop would hide behind the page size rather than
   * behind the row count. A page of 25 orders costs what a page of 5 costs;
   * anything else means a per-row read (the day grouping, a currency lookup, a
   * per-order refund total) that belongs in the query.
   *
   * `offsetPage` sends its rows query and its count query together, so the
   * floor here is two, not one — and the count query is exactly the thing that
   * must share the row query's scope (AGENTS.md), which is a correctness rule
   * this test happens to keep honest as well.
   */
  it("pages orders at a fixed cost, whatever the page size", async () => {
    const ctx = await countingShopContext({ history: true });

    const counts: number[] = [];
    for (const pageSize of [5, 10, 25]) {
      ctx.reset();
      await pagedOrdersByDay(ctx.db, ctx.shop.id, ctx.shop.timezone, {}, { page: 1, pageSize });
      counts.push(ctx.count());
    }

    expect(counts, `a per-order read would grow: ${counts.join(", ")}`).toEqual([
      counts[0],
      counts[0],
      counts[0],
    ]);
  });

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
    ctx.reset();
    const work = await getTodayWork(
      ctx.db,
      ctx.shop.id,
      ctx.shop.slug,
      ctx.shop.timezone,
      nowDate(),
    );
    expect(work).toBeTruthy();

    const used = ctx.count();
    expect(
      used,
      `the shop home sent ${used} queries; see this test's comment before raising the ceiling`,
    ).toBeLessThanOrEqual(TODAY_QUERY_CEILING);
  });
});

/**
 * The tripwire for the shop home, set well above what the reader sends today so
 * ordinary work never trips it and a loop always does. Raising it is a decision
 * about the first screen of the working day, not a maintenance chore — the test
 * above says what to ask first.
 */
const TODAY_QUERY_CEILING = 60;
