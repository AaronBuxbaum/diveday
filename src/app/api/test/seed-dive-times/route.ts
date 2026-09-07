import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { upsertExecutedDive } from "@/db/executed-dives";
import { bookings, tripDives, trips } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

const MINUTE_MS = 60 * 1000;

/**
 * Records **every planned dive of the demo recap's departure with a time in
 * and a time out**, so the after-state's fly-safe line has a last exit to
 * count from (`src/lib/fly-safe.ts`, issue #1425).
 *
 * A test route rather than a line in the seed, for the reason
 * `seed-observed-species` gives beside it: the calm `recap` capture is the day
 * with no `executed_dives` row at all, which is what most days look like at
 * the moment a diver opens the link, and it is already photographed. This is
 * the other branch — a crew that logged the day — and the line it produces
 * exists *because* they did.
 *
 * Each dive is recorded at its **planned** site with nothing else changed, so
 * the record reads as an ordinary day that went to plan. The times are laid
 * out from the departure's own `starts_at`: the first dive an hour in, each
 * fifty minutes long, an hour's surface interval between — the shape of a
 * two-tank morning, not a claim about any real one.
 *
 * Written through `upsertExecutedDive`, so the row is one the product itself
 * could have produced. Mutating the shared fixture is safe: each Playwright
 * worker owns its database and `/api/test/reset` restores the schedule before
 * every test. Gated identically to `/api/test/reset`, so it can never be
 * reachable in a real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  const [booking] = await db
    .select({ tripId: bookings.tripId, startsAt: trips.startsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  const planned = await db
    .select({ diveNumber: tripDives.diveNumber, diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(eq(tripDives.tripId, booking.tripId))
    .orderBy(asc(tripDives.diveNumber));
  if (planned.length === 0)
    return NextResponse.json({ error: "no_planned_dives" }, { status: 409 });

  const [staff] = await listStaff(db, shop.id);
  if (!staff) return NextResponse.json({ error: "no_staff" }, { status: 404 });

  let cursor = booking.startsAt.getTime() + 60 * MINUTE_MS;
  const recorded: Array<{ diveNumber: number; exitedAt: string }> = [];
  for (const dive of planned) {
    const enteredAt = new Date(cursor);
    const exitedAt = new Date(cursor + 50 * MINUTE_MS);
    const result = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: booking.tripId,
      diveNumber: dive.diveNumber,
      actualSiteId: dive.diveSiteId,
      enteredAt,
      exitedAt,
      recordedByPersonId: staff.person.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
    recorded.push({ diveNumber: dive.diveNumber, exitedAt: exitedAt.toISOString() });
    cursor = exitedAt.getTime() + 60 * MINUTE_MS;
  }

  return NextResponse.json({ ok: true, tripId: booking.tripId, recorded });
}
