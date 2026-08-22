import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { createDemoShop, deleteDemoShopCascade } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Mint a whole seeded shop of this test's own, so a spec that changes
 * shop-wide state changes nobody else's shop.
 *
 * `/api/test/reset` restores the *schedule* of the one shared blue-mantis
 * fixture — trips, bookings, waivers, the roster — and that covers most of
 * what a spec writes. What it does not cover is shop-level configuration:
 * four shop-scoped tables (`shop_backup_destinations`, `shop_backup_deliveries`,
 * `shop_whatsapp_accounts`, `media_deletion_attempts`), every `shops` column
 * but three, and the shifts and calendar feeds of the permanent staff. A spec
 * that writes any of those hands its state to whichever spec Playwright's
 * sharding happens to run next in the same worker, and that spec's premise
 * quietly changes (ADR 20260815-per-test-private-shops).
 *
 * The shop this returns is the same `isDemo` tenant "Try the live demo" mints
 * for a visitor (`createDemoShop`) — deliberately, because blue-mantis is an
 * `isDemo` shop too, so every `shop.isDemo` branch in the app renders exactly
 * as the spec is used to. It carries the full seeded schedule but **no
 * back-filled history** by opting out of the visitor demo's reporting seed:
 * the browser fleet does not need the trailing quarter of orders, tips, or
 * reviews and keeping it lean makes per-test minting faster.
 *
 * The `DELETE` below is the tidy way out, and the fixture calls it on teardown:
 * `/api/test/reset` would clear the shop anyway (it calls
 * `purgeMintedDemoShops` before every test), but that puts a whole cascade
 * delete inside the *next* test's 15-second budget for no reason. Dropping it
 * here charges the cost to the test that asked for the shop. The reset stays
 * the safety net for a run that died before teardown.
 *
 * Gated identically to /api/test/reset, so it can never be reachable in a real
 * deployment — this mints a tenant whose staff sign in with a published
 * password.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  // One transaction, like `enterDemoAction`: the cap eviction and the mint
  // commit together, and a half-seeded shop never becomes a test's fixture.
  // **`?slug=` pins the identity**, for a visual capture and nothing else.
  // `generateDemoShopIdentity` picks its words at random, and both the name and
  // the slug-derived owner email render in the staff chrome — so a screenshot of
  // a minted shop differs on every run unless the test names its own fixture
  // (`pinnedDemoShopIdentity`). Held to the same shape a slug has to have
  // anyway; anything else is refused rather than sanitised, since a caller
  // passing a bad slug wants to know.
  const requested = new URL(request.url).searchParams.get("slug");
  if (requested !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requested)) {
    return NextResponse.json({ error: "bad_slug" }, { status: 400 });
  }
  const { slug, ownerEmail } = await db.transaction(async (tx) =>
    createDemoShop(tx, { history: false, slug: requested ?? undefined }),
  );
  return NextResponse.json({ slug, ownerEmail, password: DEMO_BYPASS_PASSWORD });
}

/**
 * Drop a shop this route minted, named by `?slug=`.
 *
 * Refuses anything but a minted demo — not the canonical `blue-mantis` fixture
 * (by slug) and not a real shop (`isDemo`), the same two exclusions
 * `purgeMintedDemoShops` and the TTL reaper apply. A slug that names nothing is
 * a no-op rather than an error: teardown must not fail a passing test because
 * the reset already reaped the shop.
 */
export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || slug === DEMO_SHOP_SLUG) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ ok: true, dropped: false });
  await db.transaction(async (tx) => deleteDemoShopCascade(tx, shop.id));
  return NextResponse.json({ ok: true, dropped: true });
}
