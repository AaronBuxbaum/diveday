import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { unseededTestDb } from "@/test/db";

vi.mock("./seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seed")>();
  return {
    ...actual,
    seedIfEmpty: vi.fn(actual.seedIfEmpty),
  };
});

vi.mock("./demo-refresh", () => ({
  refreshCanonicalDemoSchedule: vi.fn(async () => ({
    found: true,
    runwayDays: 30,
    refreshed: false,
    today: "already",
  })),
}));

const { isDemoShopSeeded, refreshPgliteDemo, seedProductionDb, takeSeedLock } = await import(
  "./dev-bootstrap"
);
const { seedIfEmpty } = await import("./seed");
const { refreshCanonicalDemoSchedule } = await import("./demo-refresh");

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

describe("refreshPgliteDemo", () => {
  it("runs the demo keeper for local PGlite and refuses configured databases", async () => {
    const db = await unseededTestDb();
    vi.mocked(refreshCanonicalDemoSchedule).mockClear();

    await refreshPgliteDemo(db, "");
    expect(refreshCanonicalDemoSchedule).toHaveBeenCalledWith(db);

    await refreshPgliteDemo(db, "postgres://configured.example/db");
    expect(refreshCanonicalDemoSchedule).toHaveBeenCalledTimes(1);
  });
});

describe("takeSeedLock", () => {
  /**
   * The Postgres branch of `getDb()` passes this as `seedProductionDb`'s lock.
   * It must be transaction-scoped — held until commit or rollback and then
   * gone — so a process that dies mid-seed can never leave it stuck (CR-010).
   */
  it("holds an advisory lock for the life of the transaction, and no longer", async () => {
    const db = await unseededTestDb();
    const advisoryLocks = async (executor: Pick<typeof db, "execute">) => {
      const result = await executor.execute(
        sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`,
      );
      return (result.rows[0] as { n: number }).n;
    };

    await db.transaction(async (tx) => {
      await takeSeedLock(tx);
      expect(await advisoryLocks(tx)).toBe(1);
    });
    expect(await advisoryLocks(db)).toBe(0);
  });
});
