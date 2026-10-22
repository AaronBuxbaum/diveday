import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { armClaudeFixtures } from "@/lib/assists/e2e-fixtures";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * **Light Claude's assists on one private shop**, so the browser fleet can
 * photograph an assist's surface (ADR 20261018-claude-assists).
 *
 * Every shop the fleet mints is a demo, and a demo is dark by the seam's own
 * rule, so `POST ?slug=` clears this shop's `is_demo` and arms the canned
 * provider for it (`src/lib/assists/e2e-fixtures.ts`): its assists answer from
 * fixtures and nothing leaves the machine. `DELETE ?slug=` disarms it and
 * makes it a demo again, which the private-shop teardown needs before it will
 * drop the shop. The canonical `blue-mantis` fixture is refused: it is shared
 * by every spec.
 *
 * Gated like every `/api/test/*` route, before the body or the database.
 */
async function mintedShop(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || slug === DEMO_SHOP_SLUG) return null;
  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  return shop ? { db, shop } : null;
}

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const found = await mintedShop(request);
  if (!found?.shop.isDemo) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  await found.db.update(shops).set({ isDemo: false }).where(eq(shops.id, found.shop.id));
  armClaudeFixtures(found.shop.id, true);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const found = await mintedShop(request);
  if (!found) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  armClaudeFixtures(found.shop.id, false);
  await found.db.update(shops).set({ isDemo: true }).where(eq(shops.id, found.shop.id));
  return NextResponse.json({ ok: true });
}
