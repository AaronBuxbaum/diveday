import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";
import { unseededTestDb } from "@/test/db";

vi.mock("./seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seed")>();
  return {
    ...actual,
    seedIfEmpty: vi.fn(actual.seedIfEmpty),
  };
});

const {
  isDemoShopSeeded,
  isTransactionExecutor,
  queryAll,
  seedProductionDb,
  sqlStateOf,
  violatesUniqueIndex,
} = await import("./client");
const { seedIfEmpty } = await import("./seed");

/** A driver error as it actually arrives: wrapped, with the SQLSTATE one layer down. */
function wrappedDriverError(fields: { code: string; constraint?: string }) {
  return new DrizzleQueryError("insert into ...", [], Object.assign(new Error("boom"), fields));
}

describe("reading a failed query's SQLSTATE", () => {
  /**
   * The wrapper carries no `code` of its own, which is why
   * `/api/cron/demo-refresh` logged `sqlState: undefined` for every real query
   * failure until it read through this.
   */
  it("looks through drizzle's wrapper for the driver's own code", () => {
    const error = wrappedDriverError({ code: "23503" });
    expect((error as { code?: string }).code).toBeUndefined();
    expect(sqlStateOf(error)).toBe("23503");
  });

  it("has nothing to say about a failure that never reached the database", () => {
    expect(sqlStateOf(new Error("socket hang up"))).toBeUndefined();
    expect(sqlStateOf(undefined)).toBeUndefined();
  });

  /**
   * Naming the index is what lets a caller word one collision without also
   * swallowing an unrelated 23505 from another index the same write touched.
   */
  it("tells one unique index's violation from another's", () => {
    const error = wrappedDriverError({ code: "23505", constraint: "dive_sites_shop_name_unique" });
    expect(violatesUniqueIndex(error, "dive_sites_shop_name_unique")).toBe(true);
    expect(violatesUniqueIndex(error, "people_shop_email_unique")).toBe(false);
    expect(violatesUniqueIndex(wrappedDriverError({ code: "23503" }), "anything")).toBe(false);
  });
});

describe("queryAll", () => {
  /**
   * A transaction is one checked-out client, so concurrent queries on it are
   * queued by `pg` and warned about ("Calling client.query() when the client is
   * already executing a query is deprecated ... will be removed in pg@9"). That
   * warning was the whole of what a `Promise.all` on `tx` bought — seen in
   * production on a counter check-in, whose readiness read runs inside
   * `checkInBooking`'s transaction.
   */
  it("runs one query at a time on a transaction, and at once on the pool", async () => {
    const db = await unseededTestDb();
    const overlapping = () => {
      let live = 0;
      let peak = 0;
      return {
        peak: () => peak,
        query: async () => {
          live += 1;
          peak = Math.max(peak, live);
          await new Promise((resolve) => setTimeout(resolve, 5));
          live -= 1;
          return live;
        },
      };
    };

    const pooled = overlapping();
    await queryAll(db, [pooled.query, pooled.query, pooled.query]);
    expect(pooled.peak()).toBe(3);

    await db.transaction(async (tx) => {
      const pinned = overlapping();
      await queryAll(tx, [pinned.query, pinned.query, pinned.query]);
      expect(pinned.peak()).toBe(1);
    });
  });

  it("answers with each query's result, in order, either way", async () => {
    const db = await unseededTestDb();
    const queries = [async () => "a" as const, async () => 2, async () => [true]];

    expect(await queryAll(db, queries)).toEqual(["a", 2, [true]]);
    await db.transaction(async (tx) => {
      expect(await queryAll(tx, queries)).toEqual(["a", 2, [true]]);
    });
  });

  it("knows a transaction from the pool for both drivers' executors", async () => {
    const db = await unseededTestDb();
    expect(isTransactionExecutor(db)).toBe(false);
    await db.transaction(async (tx) => {
      expect(isTransactionExecutor(tx)).toBe(true);
    });
  });
});

describe("seedProductionDb (cold-start fast path)", () => {
  it("runs the seed on a genuinely fresh database", async () => {
    const db = await unseededTestDb();
    await expect(isDemoShopSeeded(db)).resolves.toBe(false);

    await seedProductionDb(db);

    expect(seedIfEmpty).toHaveBeenCalledTimes(1);
    await expect(isDemoShopSeeded(db)).resolves.toBe(true);
  });

  it("skips the lock and the seed once the demo-shop marker is present", async () => {
    const db = await unseededTestDb();
    // Seed once directly (bypassing the fast path under test) so the marker
    // is present before we exercise seedProductionDb.
    await seedIfEmpty(db);
    await expect(isDemoShopSeeded(db)).resolves.toBe(true);
    vi.mocked(seedIfEmpty).mockClear();

    const lock = vi.fn(async () => undefined);
    await seedProductionDb(db, { lock });

    expect(lock).not.toHaveBeenCalled();
    expect(seedIfEmpty).not.toHaveBeenCalled();
  });
});
