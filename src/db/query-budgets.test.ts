import { and, asc, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pagedOrdersByDay } from "@/db/orders";
import { listTripsReadiness } from "@/db/readiness";
import { bookings, people, personRoles, shops, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { nowDate } from "@/lib/clock";
import { countingShopContext } from "@/test/query-count";
import { getDiverRecord } from "../features/diver-record/store";
import { getTripDetails, getTripManifest } from "../features/trip-page/store";

/** The seeded shop's owner: the reader whose gates open every door on these pages. */
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
   * sequential inside a transaction (`src/db/query-helpers.ts`) — sequential is fine,
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
   * The departure page's Divers tab (`getTripManifest`): the shared trip
   * reads, the overview and guests over them, the Details selects, the stage
   * and the reader's gates; the departure's needs are Today's, and the page
   * reads them beside it. A ceiling, like the shop home's, because its fan-out is
   * one departure's roster; a per-guest read is what it is here to catch.
   */
  it("reads the departure page under a ceiling", async () => {
    const ctx = await countingShopContext();
    const personId = await seededOwner(ctx);
    const [trip] = await ctx.uncounted
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, ctx.shop.id), liveTrip(), gt(trips.startsAt, nowDate())))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("the seeded shop has no upcoming departure");
    ctx.reset();
    const manifest = await getTripManifest(ctx.db, ctx.shop, trip.id, {
      session: { user: { personId, roles: ["owner"] } },
      filters: {},
    });
    expect(manifest).not.toBeNull();

    const used = ctx.count();
    expect(used, `the departure page sent ${used} queries`).toBeLessThanOrEqual(
      TRIP_PAGE_QUERY_CEILING,
    );
  });

  it("keeps Details-only reads off Divers for boat and shore shops", async () => {
    const ctx = await countingShopContext();
    const personId = await seededOwner(ctx);
    const [trip] = await ctx.uncounted
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, ctx.shop.id), liveTrip(), ne(trips.status, "cancelled")))
      .limit(1);
    if (!trip) throw new Error("no seeded departure");
    for (const enabled of [true, false]) {
      await ctx.uncounted
        .update(shops)
        .set({ conservationEnabled: enabled })
        .where(eq(shops.id, ctx.shop.id));
      for (const hasBoatDiving of [true, false]) {
        const shop = { ...ctx.shop, hasBoatDiving };
        ctx.reset();
        const manifest = await getTripManifest(ctx.db, shop, trip.id, {
          session: { user: { personId, roles: ["owner"] } },
          filters: {},
        });
        expect(manifest).not.toBeNull();
        expect(
          ctx.statements.some((sql) => /from "trip_conservation"|from "trip_lenses"/.test(sql)),
        ).toBe(false);
        const diversQueries = ctx.count();
        const details = await getTripDetails(ctx.db, shop, trip.id, personId);
        expect(ctx.count()).toBeGreaterThan(diversQueries);
        expect(details.conservation === null).toBe(!enabled);
        if (!hasBoatDiving) expect(details.boats).toEqual([]);
      }
    }
  });

  /**
   * The diver record (`getDiverRecord`): the profile, the gates and the file's
   * groups, then the reads that need the gates. Bounded by one diver, so a
   * ceiling; a per-booking or per-piece read is what it catches.
   */
  it("reads a diver record under a ceiling", async () => {
    const ctx = await countingShopContext();
    const viewerPersonId = await seededOwner(ctx);
    const [diver] = await ctx.uncounted
      .select({ id: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.shopId, ctx.shop.id), isNotNull(bookings.personId)))
      .limit(1);
    if (!diver) throw new Error("the seeded shop has no booked diver");
    ctx.reset();
    const record = await getDiverRecord(ctx.db, ctx.shop, diver.id, {
      viewerPersonId,
      activityPage: 1,
      bookingPage: 1,
      now: nowDate(),
    });
    expect(record?.kind).toBe("record");

    const used = ctx.count();
    expect(used, `the diver record sent ${used} queries`).toBeLessThanOrEqual(
      DIVER_RECORD_QUERY_CEILING,
    );
  });
});

/**
 * The departure page's tripwire (issue #2757, measured when its reads moved
 * behind `getTripManifest`). Raising it is a decision about the page the desk
 * works a departure from.
 */
const TRIP_PAGE_QUERY_CEILING = 143;

/** The diver record's tripwire (issue #2757, measured when its reads moved behind `getDiverRecord`). */
const DIVER_RECORD_QUERY_CEILING = 75;
