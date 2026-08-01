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
  return NextResponse.json({ ok: true });
}
