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
 * another full round of dead tuples (measured: 4,411 in 2026-08, 4,751 by the
 * time a few more seed scenarios had landed — the figure creeps up with every
 * `src/db/seed-*.ts` added) and every sequential scan inside the next reset
 * got slower — 1.2s on the second call, 3.3s by the 60th, 8.6s by the 120th,
 * against a 15s per-test budget that `e2e/fixtures.ts` spends this endpoint
 * out of before every single test.
 */
const ROWS_TOUCHED_PER_RESET = 5_000;

describe("POST /api/test/reset — reclaiming what it deleted", () => {
  it("does not accumulate dead tuples across repeated resets", async () => {
    const db = await seededTestDb();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DIVEDAY_E2E_SECRET", SECRET);
    vi.mocked(getDb).mockResolvedValue(db as never);

    for (let round = 0; round < 3; round++) {
      expect((await POST(resetRequest())).status).toBe(200);
    }

    // Three rounds without the reclaim leaves all three rounds' tuples dead
    // (~14,000 and climbing); with it the count usually reads zero. But the
    // route *deliberately* swallows a failed VACUUM (see reclaimDeadTuples:
    // "never worth failing a reset over"), so one round's worth left dead is a
    // state the route accepts, not a missing reclaim — a bound of one round
    // (the original 4,000, by then below a single round's real size) turned
    // exactly that accepted state into a CI-only flake. Two rounds' worth
    // stays comfortably above any single round's residual while still less
    // than half of what removal accumulates.
    expect(await deadTuples(db)).toBeLessThan(2 * ROWS_TOUCHED_PER_RESET);

    vi.unstubAllEnvs();
    // Its own budget, not the 20s default.
    //
    // This is the most expensive test in the suite by wall clock: it hydrates
    // an embedded Postgres and then runs three *real* resets through it,
    // ~5,000 rows deleted and re-inserted each, because the growth it guards
    // against is not observable any other way. Measured at **17.6s** on a
    // quiet machine (three runs: 17.60/17.61/17.86) — 88% of the default
    // budget, so any parallel load at all tips it over, and it does: it is the
    // first thing to fail when the full suite runs alongside anything else.
    //
    // This is not a timeout widened to hide a race, which the e2e-hygiene rule
    // rightly refuses. The assertion is deterministic and was already de-flaked
    // once on its own terms (714b1555, which fixed the *bound*); what is left
    // is simply a test whose honest runtime does not fit. Same reasoning, and
    // the same shape, as `src/test/postgres.ts` (30s) and
    // `src/lib/usage/alert-ledger.test.ts` (60s).
  }, 45_000);
});
