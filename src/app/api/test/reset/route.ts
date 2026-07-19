import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { getShopBySlug } from "@/db/queries";
import { resetDemoSchedule } from "@/db/seed";

/**
 * Resets the seeded demo shop's schedule to its canonical fixture state.
 * Exists only for e2e test isolation (e2e/fixtures.ts calls this before
 * every test, including unauthenticated ones, so it deliberately doesn't
 * require a staff session the way resetDemoAction does) — never available
 * against a real database, so it can't reach production regardless of how
 * this route is deployed. The isDemo check keeps it from ever touching a
 * non-demo shop even if DEMO_SHOP_SLUG's target ever changed.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (shop?.isDemo) {
    await resetDemoSchedule(db, shop.id);
  }
  return NextResponse.json({ ok: true });
}
