import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { trips } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { setLogSink } from "@/lib/log";
import { seededShopContext } from "@/test/db";
import {
  QUERY_TIMING_EVENT,
  queryTimingLogger,
  reportRenderQueries,
  withQueryStats,
  withStatementTiming,
} from "./query-timing";

/** The seeded database, re-opened with the driver timing and logger `src/db/client.ts` installs. */
async function timedShopContext() {
  const { db, shop } = await seededShopContext();
  const timed = drizzle({
    client: withStatementTiming(db.$client as PGlite),
    logger: queryTimingLogger,
  }) as unknown as AppDb;
  return { db: timed, shop };
}

afterEach(() => {
  setLogSink(null);
  vi.restoreAllMocks();
});

describe("counting a request's statements", () => {
  it("counts one per statement a real reader sends, inside its own scope", async () => {
    const { db, shop } = await timedShopContext();
    const { result, stats } = await withQueryStats(async () => {
      const row = await getShopById(db, shop.id);
      await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
      return row;
    });
    expect(result?.id).toBe(shop.id);
    expect(stats.queries).toBe(2);
  });

  it("keeps two concurrent scopes apart", async () => {
    const { db, shop } = await timedShopContext();
    const [one, three] = await Promise.all([
      withQueryStats(() => getShopById(db, shop.id)),
      withQueryStats(async () => {
        await getShopById(db, shop.id);
        await getShopById(db, shop.id);
        await getShopById(db, shop.id);
      }),
    ]);
    expect(one.stats.queries).toBe(1);
    expect(three.stats.queries).toBe(3);
  });

  it("drops a statement sent outside every scope instead of failing it", async () => {
    const { db, shop } = await timedShopContext();
    await expect(getShopById(db, shop.id)).resolves.toMatchObject({ id: shop.id });
  });
});

describe("timing a request's statements", () => {
  it("adds each statement's own time to the scope that sent it", async () => {
    const { db, shop } = await timedShopContext();
    const startedAt = performance.now();
    const { stats } = await withQueryStats(async () => {
      await getShopById(db, shop.id);
      await getShopById(db, shop.id);
    });
    const elapsed = performance.now() - startedAt;
    expect(stats.queries).toBe(2);
    expect(stats.dbMs).toBeGreaterThan(0);
    // One after the other, the statements' own time fits inside the wall time.
    expect(stats.dbMs).toBeLessThanOrEqual(elapsed);
  });

  it("times a statement inside a transaction as well", async () => {
    const { db, shop } = await timedShopContext();
    const { stats } = await withQueryStats(() =>
      db.transaction(async (tx) => {
        await tx.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
      }),
    );
    // PGlite runs BEGIN and COMMIT itself; the read is the one statement
    // Drizzle sends, through the transaction's own client.
    expect(stats.queries).toBe(1);
    expect(stats.dbMs).toBeGreaterThan(0);
  });

  it("keeps a scope's time its own when two run at once", async () => {
    const { db, shop } = await timedShopContext();
    const [none, some] = await Promise.all([
      withQueryStats(async () => undefined),
      withQueryStats(() => getShopById(db, shop.id)),
    ]);
    expect(none.stats.dbMs).toBe(0);
    expect(some.stats.dbMs).toBeGreaterThan(0);
  });
});

describe("reporting a render", () => {
  it("writes one line after the response, naming the route the page sharpened it to", async () => {
    const { db, shop } = await timedShopContext();
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const scheduled: (() => void)[] = [];
    const schedule = (task: () => void) => {
      scheduled.push(task);
    };

    await withQueryStats(async () => {
      reportRenderQueries("/shop/**", schedule, { fallback: true });
      await getShopById(db, shop.id);
      reportRenderQueries("/shop/[shopSlug]/divers", schedule);
      await getShopById(db, shop.id);
      reportRenderQueries("/shop/[shopSlug] (chrome)", schedule, { fallback: true });
    });

    expect(scheduled).toHaveLength(1);
    expect(lines).toEqual([]);
    scheduled[0]?.();
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}");
    expect(line).toMatchObject({
      event: QUERY_TIMING_EVENT,
      level: "info",
      route: "/shop/[shopSlug]/divers",
      queries: 2,
    });
    expect(line.ms).toBeGreaterThanOrEqual(0);
    expect(line.db_ms).toBeGreaterThanOrEqual(0);
  });

  it("reports nothing from outside every scope, where its count would always be zero", () => {
    const schedule = vi.fn();
    reportRenderQueries("/shop/**", schedule);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("stays quiet when there is no response to wait for", async () => {
    await withQueryStats(async () => {
      expect(() =>
        reportRenderQueries("/shop/**", () => {
          throw new Error("`after` was called outside a request scope");
        }),
      ).not.toThrow();
    });
  });
});
