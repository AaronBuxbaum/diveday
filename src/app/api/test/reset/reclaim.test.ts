import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
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

/** Rows Postgres has deleted or superseded but not yet handed back to the allocator. */
async function deadTuples(db: Awaited<ReturnType<typeof seededTestDb>>): Promise<number> {
  const result = await db.execute(
    sql`select coalesce(sum(n_dead_tup), 0)::bigint as dead from pg_stat_user_tables`,
  );
  const rows = (result as unknown as { rows: { dead: string }[] }).rows;
  return Number(rows[0]?.dead ?? 0);
}

/**
 * One reset deletes and re-inserts roughly this many rows. PGlite ships no
 * autovacuum worker, so without the route reclaiming them every call left
 * another full round of dead tuples (measured: 4,411 each, ~2MB of heap) and
 * every sequential scan inside the next reset got slower — 1.2s on the second
 * call, 3.3s by the 60th, 8.6s by the 120th, against a 15s per-test budget
 * that `e2e/fixtures.ts` spends this endpoint out of before every single test.
 */
const ROWS_TOUCHED_PER_RESET = 4_000;

describe("POST /api/test/reset — reclaiming what it deleted", () => {
  it("does not accumulate dead tuples across repeated resets", async () => {
    const db = await seededTestDb();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", SECRET);
    vi.mocked(getDb).mockResolvedValue(db as never);

    for (let round = 0; round < 3; round++) {
      expect((await POST(resetRequest())).status).toBe(200);
    }

    // Three rounds without the reclaim leaves ~13,000 dead tuples and climbing;
    // with it, the count sits at zero. The bound is one round's worth, so this
    // fails loudly on removal while never tripping on ordinary churn.
    expect(await deadTuples(db)).toBeLessThan(ROWS_TOUCHED_PER_RESET);

    vi.unstubAllEnvs();
  });
});
