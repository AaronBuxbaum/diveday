import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { purgeMintedDemoShops, resetDemoSchedule } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Resets the seeded demo shop's schedule to its canonical fixture state.
 * Exists only for e2e test isolation (e2e/fixtures.ts calls this before
 * every test, including unauthenticated ones, so it deliberately doesn't
 * require a staff session the way resetDemoAction does). The isDemo check
 * below keeps it from ever touching a non-demo shop even if DEMO_SHOP_SLUG's
 * target ever changed.
 *
 * It wipes and reseeds data, so it must never be reachable in a real
 * deployment — see `e2eTestRouteAuthorized` for the two independent guards
 * (env-var predicate + `DIVEDAY_E2E_SECRET` bearer token) enforcing that.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (shop?.isDemo) {
    // Browser tests rely on the canonical demo's historical orders and trips
    // as well as its schedule. Unit fixtures keep the lean default, but the
    // E2E reset must restore the full customer-facing demo.
    await resetDemoSchedule(db, shop.id, { history: true });
  }
  // Clear any disposable demo shops earlier tests minted via "Try the live
  // demo", so they don't accumulate and bloat the shared test database.
  await purgeMintedDemoShops(db);
  await reclaimDeadTuples(db);
  return NextResponse.json({ ok: true });
}

/**
 * Hand the rows this reset just deleted back to the page allocator.
 *
 * A reset deletes and re-inserts ~4,400 rows, and PGlite ships no autovacuum
 * worker, so nothing ever reclaims the dead tuples: every call left another
 * ~4,400 of them and ~2MB of heap behind. One worker server serves this
 * endpoint once per test, so across a full local suite (~150 tests on one
 * server) the heap grew past 300MB and every sequential scan inside the reset
 * got slower with it — measured at 1.2s on the second call, 3.3s by the 60th,
 * 8.6s by the 120th. The 15s per-test budget then goes to the reset alone and
 * the tail of the run fails in whatever spec happens to be there, which reads
 * as a flake that moves around between runs. Vacuuming here holds it flat:
 * dead tuples 0, heap 17MB, ~1.2s per reset however long the server lives.
 *
 * CI never hit this because it shards onto fresh servers (~76 tests each), so
 * the growth stayed under the budget — this only ever bit a full local run.
 *
 * Cheap *because* it runs every time: 24ms against one round's worth of dead
 * tuples, versus 384ms once a hundred rounds have piled up (and by then plain
 * VACUUM no longer helps — it returns pages to the heap's free list, not to the
 * OS, so the scans still traverse the bloat). Plain VACUUM, not FULL: FULL
 * rewrites every table under an exclusive lock, which costs far more than it
 * saves when the point is simply to stop the heap from growing.
 *
 * Route-local rather than inside `resetDemoSchedule`, because that function is
 * also what the in-app "reset demo shop" action calls against real Postgres,
 * where autovacuum already does this and `VACUUM` needs privileges no request
 * should assume. This endpoint is e2e-only behind two independent guards.
 */
async function reclaimDeadTuples(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  // Postgres refuses VACUUM inside a transaction block, so it is deliberately
  // not wrapped in one. A failure here is never worth failing a reset over —
  // the fixture is already restored by this point, and the only cost of
  // skipping it is the slow growth this exists to prevent.
  try {
    await db.execute(sql`vacuum`);
  } catch {
    // Nothing to do: a runtime without VACUUM still gets a correct reset.
  }
}
