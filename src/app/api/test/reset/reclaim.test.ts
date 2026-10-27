import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturedDemoResetPlan } from "@/db/demo-reset-snapshot";
import { seededTestDb } from "@/test/db";

// Only the db handle is stubbed: this exercises the *real* reset against a
// real embedded Postgres, which is the only way the growth this guards
// against is observable at all.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { POST } = await import("./route");

const SECRET = "e2e-test-secret";

function resetRequest() {
  return new Request("http://localhost/api/test/reset", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

/** VACUUM reports its completed work directly, without pending DML counters. */
async function vacuumCounts(db: Awaited<ReturnType<typeof seededTestDb>>) {
  const result = await db.execute(
    sql`select relname, vacuum_count from pg_stat_user_tables where schemaname = 'public'`,
  );
  const rows = (result as unknown as { rows: { relname: string; vacuum_count: number }[] }).rows;
  return new Map(rows.map((row) => [row.relname, Number(row.vacuum_count)]));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/test/reset — reclaiming what it deleted", () => {
  it("successfully vacuums every reset-owned table across repeated resets", async () => {
    const db = await seededTestDb();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", SECRET);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const before = await vacuumCounts(db);
    for (let round = 1; round <= 3; round++) {
      expect((await POST(resetRequest())).status).toBe(200);
      const plan = capturedDemoResetPlan(db);
      if (plan === null) throw new Error("Reset did not capture a replay plan");
      const tables = new Set([...plan.inserts, ...plan.updates].map((step) => step.table));
      expect(tables.size).toBeGreaterThan(0);
      // Exercise the delayed-counter flush that made n_dead_tup unreliable.
      await db.execute(sql`select pg_stat_force_next_flush()`);
      const after = await vacuumCounts(db);
      for (const table of tables) {
        expect(after.get(table), `${table}, reset ${round}`).toBe((before.get(table) ?? 0) + round);
      }
    }

    // n_dead_tup is an estimate: pending DELETE counters can flush after a
    // successful VACUUM and add the reclaimed rows back to that estimate.
    // vacuum_count instead proves each real command completed, including
    // the full capture vacuum and every targeted snapshot replay vacuum.
    // This hydrates Postgres and performs three real resets within its existing budget.
  }, 45_000);
});
