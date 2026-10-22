import { and, desc, eq, isNull, lt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { type AppDb, getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { bookings, shops, tripReviews, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { armClaudeFixtures, e2eClaudeFixtureProvider } from "@/lib/assists/e2e-fixtures";
import { nowDate } from "@/lib/clock";
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
 * drop the shop; it refuses a shop this server did not arm. The canonical
 * `blue-mantis` fixture is refused: it is shared by every spec.
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
  // `?review=1`: one commented review waiting for moderation, on a departure
  // that has sailed, so the review flags have a row to mark. A minted shop
  // carries no review history of its own.
  if (new URL(request.url).searchParams.get("review") === "1") {
    await seedWaitingReview(found.db, found.shop.id);
  }
  return NextResponse.json({ ok: true });
}

async function seedWaitingReview(db: AppDb, shopId: string): Promise<void> {
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(tripReviews, eq(tripReviews.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.shopId, shopId),
        lt(trips.startsAt, nowDate()),
        ne(bookings.status, "cancelled"),
        isNull(tripReviews.id),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!seat?.personId) return;
  await db.insert(tripReviews).values({
    shopId,
    bookingId: seat.id,
    tripId: seat.tripId,
    personId: seat.personId,
    rating: 4,
    // i18n-exempt: a diver's own words, seeded for the browser fleet
    comment: "Lovely reef and a patient crew. Text me on 305 555 0199 when the night dive runs.",
  });
}

export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const found = await mintedShop(request);
  // Only a shop this server armed goes back to being a demo: anything else
  // (a real tenant, a shop disarmed already) keeps its flag.
  if (!found || !e2eClaudeFixtureProvider(found.shop.id)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  armClaudeFixtures(found.shop.id, false);
  await found.db.update(shops).set({ isDemo: true }).where(eq(shops.id, found.shop.id));
  return NextResponse.json({ ok: true });
}
