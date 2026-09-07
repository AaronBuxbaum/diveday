import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueBookingHandoff } from "@/db/booking-handoff";
import { getDb } from "@/db/client";
import { bookings, people, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { liveTrip } from "@/db/trips-live";
import { handoffHref } from "@/lib/booking-handoff";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { publicTripPath } from "@/lib/public-routes";

/**
 * Hands a spec the booking page **as a known diver reaches it** (ADR
 * 20260906-before-you-ask, decision 3): a ten-minute handoff minted from the
 * diver's own booking, on the shop's next public departure that is not that
 * booking's. In the product only `/ready/<token>` mints one, from the thread's
 * next-dive card; a spec that wants the known diver's page without walking the
 * thread takes it from here.
 *
 * Writes only what the thread would have written: one `booking_capabilities`
 * row, resolved inside the named shop for the named email. Mutating is safe
 * because of the fleet's topology (`e2e/servers.ts`): each Playwright worker
 * owns its own server and database, reset before every test. Gated
 * identically to `/api/test/reset`, so it can never answer in a real
 * deployment.
 */
const bodySchema = z.object({
  shopSlug: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop) return NextResponse.json({ error: "shop_not_found" }, { status: 404 });

  const [own] = await db
    .select({ bookingId: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!own) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });

  const [next] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        ne(trips.id, own.tripId),
        gte(trips.startsAt, nowDate()),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) return NextResponse.json({ error: "no_next_departure" }, { status: 404 });

  const issued = await issueBookingHandoff(db, { shopId: shop.id, bookingId: own.bookingId });
  if (!issued) return NextResponse.json({ error: "handoff_refused" }, { status: 409 });
  return NextResponse.json({ href: handoffHref(publicTripPath(shop.slug, next.id), issued.token) });
}
