import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { submitRecapPulse } from "@/db/recap-pulses";
import { bookings } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Files **one open private pulse** against the pinned demo recap booking, so
 * the staff panel that renders it can be photographed (D40, issue #1200).
 *
 * A test route rather than a line in the seed, and this is the class AGENTS.md
 * names explicitly: a block that renders nothing at all until something has
 * gone wrong is photographed through `/api/test/*`, never by seeding the
 * failure into blue-mantis. A demo shop permanently telling every visitor that
 * a diver's rental gear was faulty is a worse demo — and it would also make the
 * panel's whole point invisible, which is that it appears *because somebody
 * asked for something to be fixed* and disappears again when it is dealt with.
 *
 * Written through `submitRecapPulse` rather than inserted directly, so the row
 * is one the product itself could have produced: shop, trip and person are
 * derived from the booking exactly as they are for a real diver, and the check
 * constraints and the partial unique index are all in play.
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

  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  // Two categories and a note, which is the shape a real one arrives in: the
  // codes say what to look at, the sentence says what happened. The words are
  // fixture text and stay in this file — nothing in `src/db` or `src/i18n`
  // holds them, because nothing in the product ever renders them.
  const result = await submitRecapPulse(db, {
    bookingId: booking.id,
    categories: ["gear", "briefing"],
    note: "The BCD inflator stuck twice and nobody mentioned the current on the north end.",
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({ ok: true });
}
