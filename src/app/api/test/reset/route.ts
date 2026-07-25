import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { purgeMintedDemoShops, resetDemoSchedule } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";

/**
 * Resets the seeded demo shop's schedule to its canonical fixture state.
 * Exists only for e2e test isolation (e2e/fixtures.ts calls this before
 * every test, including unauthenticated ones, so it deliberately doesn't
 * require a staff session the way resetDemoAction does). The isDemo check
 * below keeps it from ever touching a non-demo shop even if DEMO_SHOP_SLUG's
 * target ever changed.
 *
 * It wipes and reseeds data, so it must never be reachable in a real
 * deployment. Two independent guards enforce that:
 *   1. A real database (DATABASE_URL) is always set in production and never in
 *      the e2e fleet — this alone blocks production.
 *   2. Outside a production runtime the route is freely available for `pnpm
 *      dev` and the dev-server e2e path. Inside one — the precompiled
 *      `next start` servers the browser suite runs against — it additionally
 *      requires the harness to opt in via DIVEDAY_E2E, which production never
 *      sets.
 */
export async function POST() {
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (shop?.isDemo) {
    await resetDemoSchedule(db, shop.id);
  }
  // Clear any disposable demo shops earlier tests minted via "Try the live
  // demo", so they don't accumulate and bloat the shared test database.
  await purgeMintedDemoShops(db);
  return NextResponse.json({ ok: true });
}
