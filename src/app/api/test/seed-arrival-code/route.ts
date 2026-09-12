import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { bookings, people, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { liveTrip } from "@/db/trips-live";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * **The arrival code a diver scans at the counter tablet** (issue #1600), for
 * the one test that cannot read it any other way.
 *
 * The credential lives on a diver's arrival card as a QR image and nothing
 * else: `src/app/s/[shopSlug]/trips/[id]/arrival-card/route.ts` draws it with
 * `QRCode.toDataURL`, so the saved file holds a `data:image/png` URL and no
 * text. A Playwright spec that downloads the card therefore cannot read the
 * token back out without a QR *decoder*, and this repository has an encoder
 * only — adding one is a new runtime dependency and an ADR, and printing the
 * token as text beside the QR would be a change to the credential's design
 * rather than to its test (issue #1725).
 *
 * So this mints one, through the product's own writer. `issueBookingCapability`
 * refuses a cancelled booking and retires the oldest live rows past the
 * per-purpose ceiling, which is what makes the code the counter resolves a row
 * the product could actually have made.
 *
 * **Demo shops only**, unlike `seed-booking-handoff` beside it, which resolves
 * any shop by slug. What that one mints is a ten-minute link onto a booking
 * page; what this one mints *writes an arrival on a manifest*, so it takes
 * `seed-display-token`'s stricter rule: past the bearer guard the slug is
 * caller-supplied, and a working arrival code over a real shop's day is not a
 * fixture.
 *
 * Gated identically to `/api/test/reset`, and listed in the shared refusal
 * table (`../seed-routes.test.ts`). Mutating is safe because of the fleet's
 * topology (`e2e/servers.ts`): each Playwright worker owns its own server and
 * in-memory database, reset before every test.
 */
const bodySchema = z.object({
  slug: z.string().trim().min(1).optional(),
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.slug ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  /**
   * **The diver's nearest scheduled departure**, earliest first.
   *
   * The tablet's window is deliberately narrow — `kioskArrivalsWindow` reaches
   * six hours forward and thirty minutes back (`src/lib/operational-window.ts`)
   * — and `findKioskSeats` applies it to the seat a code resolves to, exactly
   * as it does to a typed surname. A code minted against a departure outside
   * it answers the same "See the desk" a miss does, so a spec built on the
   * wrong seat would prove nothing at all while passing.
   */
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(people.email, parsed.data.email.toLowerCase()),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!seat) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });

  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: seat.id,
    purpose: "arrival",
    now: nowDate(),
  });
  if (!issued) return NextResponse.json({ error: "capability_refused" }, { status: 409 });
  return NextResponse.json({ token: issued.token });
}
