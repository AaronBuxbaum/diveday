import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { upsertExecutedDive } from "@/db/executed-dives";
import { MARINE_LIFE_CATALOG } from "@/db/marine-life-catalog";
import { bookings, diveSiteCreatures, tripDives } from "@/db/schema";
import { DEMO_RECAP_BOOKING_ID } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Records **one species the crew saw** on the demo recap's first dive, so the
 * "Seen on the day" line has something to render (issue #1190, delight report
 * D30).
 *
 * A test route rather than a line in the seed, the same call
 * `seed-changed-dive-site` makes beside it and for the same reason AGENTS.md
 * gives for the trouble states: the calm variant is the one the demo should
 * be, and it is already photographed — `recap` captures this page with no
 * `executed_dives` row at all, which is what most days look like. A demo whose
 * every recap announced a turtle would be a worse demo, and would also make the
 * boundary invisible: the whole point is that the line appears *because
 * somebody wrote it down*.
 *
 * Deliberately **not** folded into `seed-changed-dive-site`. A sighting is not
 * a departure from the plan — most days that turn up a turtle go exactly where
 * they meant to — and photographing the two together would suggest they travel
 * as a pair.
 *
 * It records the dive at its **planned** site, not somewhere else, so the row
 * reads as an ordinary day with one good moment in it.
 *
 * Written through `upsertExecutedDive` rather than inserted directly, so the
 * row is one the product itself could have produced. A route that bypassed the
 * writer could photograph a sighting no crew member could ever record.
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
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, DEMO_RECAP_BOOKING_ID))
    .limit(1);
  if (!booking) return NextResponse.json({ error: "no_booking" }, { status: 404 });

  const [planned] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(and(eq(tripDives.tripId, booking.tripId), eq(tripDives.diveNumber, 1)))
    .limit(1);
  if (!planned?.diveSiteId) return NextResponse.json({ error: "no_planned_site" }, { status: 409 });

  // **Off the site's guide, deliberately.** The guide is the eight faces the
  // reef shows reliably; a sighting is worth recording because it was not the
  // usual, so a demo whose one sighting is also on the briefing list would
  // photograph the two claims as the same claim. This picks a catalog species
  // the site is *not* named for, which is the shape a real crew records.
  const listed = await db
    .select({ slug: diveSiteCreatures.catalogSlug })
    .from(diveSiteCreatures)
    .where(
      and(
        eq(diveSiteCreatures.shopId, shop.id),
        eq(diveSiteCreatures.diveSiteId, planned.diveSiteId),
      ),
    );
  const guide = new Set(listed.map((row) => row.slug));
  const species = MARINE_LIFE_CATALOG.map((entry) => entry.slug).find((slug) => !guide.has(slug));
  if (!species) return NextResponse.json({ error: "no_species" }, { status: 409 });

  const [staff] = await listStaff(db, shop.id);
  if (!staff) return NextResponse.json({ error: "no_staff" }, { status: 404 });

  const result = await upsertExecutedDive(db, {
    shopId: shop.id,
    tripId: booking.tripId,
    diveNumber: 1,
    actualSiteId: planned.diveSiteId,
    observedSpeciesSlug: species,
    recordedByPersonId: staff.person.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({ ok: true, species });
}
