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
 *
 * ---
 *
 * Asked again on 2026-08-15, about a different suspect, and answered no.
 *
 * Around a dozen specs go through `/onboard` and create a **real** trial shop
 * (`isDemo: false`). Nothing clears those: `resetDemoSchedule` is scoped to
 * blue-mantis and `purgeMintedDemoShops` takes only `isDemo` shops, so they
 * accumulate for the life of the worker's server. The question was whether that
 * accumulation is part of why a long combined run gets slower. It is not.
 *
 * Method, the same one as above: a full combined `pnpm exec playwright test`
 * (599 tests, 5 workers, 11.7 minutes) with this route reporting its own
 * timings, the shop/row counts in its database, and `os.loadavg()` on every
 * call. 589 resets sampled. Three readings, in increasing order of how much
 * they settle it:
 *
 *   1. The accumulation is trivial in the only terms the reset cares about. A
 *      worker that reached 6 shops was carrying 148 people, 97 trips, 576
 *      bookings and 12.2MB of heap, against 142 / 94 / 575 / 11.7MB at one
 *      shop. Six extra `people` rows. A trial shop is a shop nobody dived at.
 *   2. Held at one instant, more shops did not cost more. Comparing workers
 *      inside the same 30-second window (same box, same contention, different
 *      accumulation), the ones carrying 4-6 shops ran 104ms **faster** than the
 *      ones carrying 1-2 — 95% CI [-445, +238] ms, so: no effect, and the point
 *      estimate has the wrong sign.
 *   3. The control worker slowed down exactly as much with nothing to
 *      accumulate. One of the five servers never saw an onboarding spec and sat
 *      at one shop for all 113 of its resets; its median went 882ms in its first
 *      ten to 3,099ms in its last ten, matching the workers that reached six.
 *
 * What the cost does track is the machine. Bucketed by 1-minute load average on
 * a contended 10-core box: 1,245ms below load 15, 2,589ms at 15-25, 3,402ms at
 * 40-70. Dead tuples and heap stayed flat across the whole run (716 -> 16 dead,
 * 10.8MB -> 12.2MB), which is this function still doing its job.
 *
 * So: do not widen this route into "delete every shop that is not blue-mantis"
 * to fix a cost that is not there. That would put a delete-everything-else
 * primitive behind a test route whose only protection is the `DIVEDAY_E2E`
 * predicate and a bearer token, and it is the opposite of how every other
 * delete path here is written — `purgeMintedDemoShops` and the TTL reaper both
 * refuse anything but a minted demo, and `deleteDemoShopCascade`'s docblock
 * says never to call it on a real shop.
 *
 * The one rule the onboarding specs do owe: **their slugs must be unique per
 * run**. Nothing collects them, so a fixed slug collides with itself the moment
 * the same database sees the spec twice — a local rerun against a
 * `reuseExistingServer` fleet, for one. `demo.spec.ts` and `nitrox.spec.ts`
 * were both fixed slugs until 2026-08-15; both carry `Date.now()` + pid now.
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
