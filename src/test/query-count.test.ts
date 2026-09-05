import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { trips } from "@/db/schema";
import { seededShopContext } from "./db";
import { countQueries, expectQueryCountInvariant } from "./query-count";

/**
 * The counter, held to the one thing its users depend on: that it fails on a
 * loop and does not fail on a batch.
 *
 * `pnpm agent:health` reports which guards have no test pinning their
 * judgement, and a budget test nobody has ever seen fail is exactly that — it
 * passes whether or not the mechanism underneath it works, which is the same
 * signal as no test at all. So both shapes are written out here against a real
 * database rather than described.
 */
describe("counting queries", () => {
  it("counts one statement per round trip, and nothing for building a query", async () => {
    const { db, shop } = await seededShopContext();
    const log = countQueries(db);

    // Drizzle's builder is lazy: this sends nothing until it is awaited.
    const pending = log.db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
    expect(log.count()).toBe(0);

    await pending;
    expect(log.count()).toBe(1);
  });

  it("forgets everything on reset, so a test can arrange before it measures", async () => {
    const { db, shop } = await seededShopContext();
    const log = countQueries(db);
    await log.db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
    expect(log.count()).toBe(1);

    log.reset();
    expect(log.count()).toBe(0);
    expect(log.statements).toEqual([]);
  });

  /**
   * The reason the whole helper exists. A reader written this way is correct —
   * it returns exactly the right rows — and costs one round trip per row.
   */
  it("refuses a reader that reads one row at a time", async () => {
    const { db, shop } = await seededShopContext();
    const log = countQueries(db);
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(4);
    const ids = rows.map((row) => row.id);
    expect(ids.length).toBe(4);

    await expect(
      expectQueryCountInvariant(log, [1, 2, 4], async (size) => {
        const found = [];
        for (const id of ids.slice(0, size)) {
          found.push(await log.db.select({ id: trips.id }).from(trips).where(eq(trips.id, id)));
        }
        return found;
      }),
    ).rejects.toThrow(/query count grows with input size/);
  });

  it("passes the same reader written as one query over the whole set", async () => {
    const { db, shop } = await seededShopContext();
    const log = countQueries(db);
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(4);
    const ids = rows.map((row) => row.id);

    const cost = await expectQueryCountInvariant(log, [1, 2, 4], (size) =>
      log.db
        .select({ id: trips.id })
        .from(trips)
        .where(inArray(trips.id, ids.slice(0, size))),
    );
    expect(cost).toBe(1);
  });
});
