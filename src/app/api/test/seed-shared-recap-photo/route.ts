import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { bookings, recapPhotos } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Shares **one of the demo recap diver's own photos with the boat**, so the
 * recap can be photographed with the sharer's "Stop sharing" on it (H-20261014-share-photo-with-boat,
 * issue #2806).
 *
 * The primary demo recap stays unshared, so its shared state is reached here
 * by setting the one column the upload tick sets (ADR
 * 20261016-shared-boat-photos §1). `?secondary=1` finds the separate seeded
 * shared photo without changing either recap.
 *
 * Mutating the shared fixture is safe: each Playwright worker owns its database
 * and `/api/test/reset` restores the schedule before every test. Gated
 * identically to `/api/test/reset`, so it can never be reachable in a real
 * deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  // The demo's own secondary diver already shared a photo during seeding.
  // Return only its booking id so a browser test can open that real recap.
  if (new URL(request.url).searchParams.get("secondary") === "1") {
    const [photo] = await db
      .select({ bookingId: recapPhotos.bookingId })
      .from(recapPhotos)
      .where(
        and(
          eq(recapPhotos.shopId, shop.id),
          ne(recapPhotos.bookingId, DEMO_RECAP_BOOKING_ID),
          isNotNull(recapPhotos.sharedWithBoatAt),
        ),
      )
      .limit(1);
    return photo
      ? NextResponse.json({ bookingId: photo.bookingId })
      : NextResponse.json({ error: "no_secondary_photo" }, { status: 404 });
  }

  // The shop on the read and on the write, not only on the guard (issue #1812).
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, DEMO_RECAP_BOOKING_ID), eq(bookings.shopId, shop.id)))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  const [photo] = await db
    .select({ id: recapPhotos.id })
    .from(recapPhotos)
    .where(and(eq(recapPhotos.bookingId, booking.id), eq(recapPhotos.shopId, shop.id)))
    .orderBy(asc(recapPhotos.createdAt))
    .limit(1);
  if (!photo) return NextResponse.json({ error: "no_photo" }, { status: 404 });

  await db
    .update(recapPhotos)
    .set({ sharedWithBoatAt: nowDate() })
    .where(and(eq(recapPhotos.id, photo.id), eq(recapPhotos.shopId, shop.id)));
  return NextResponse.json({ ok: true });
}
