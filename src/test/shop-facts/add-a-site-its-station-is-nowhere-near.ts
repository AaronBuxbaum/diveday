import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { createDiveSite } from "../../db/dive-sites";
import { diveSites } from "../../db/schema/index";

/**
 * **A site whose tide station is nowhere near it** (issue #1772) — the
 * dive-site editor's implausible-station advisory, and the box that answers
 * it, neither of which the Playwright fleet could reach.
 *
 * `fixtureTideStation` (`src/features/tide-stations/rules.ts`) answers **Carysfort Reef**
 * for every seven-digit id, on purpose: one station for every id is what keeps
 * the fleet deterministic with NOAA unreachable. So the distance cannot come
 * from the station — it has to come from the *site*. This one sits on the
 * Flower Garden Banks, about 1,400 km west of Carysfort in the Gulf, which is
 * the genuinely-remote case ADR 20260907-noaa-tide-predictions names when it
 * argues the advisory has to be answerable rather than raised forever.
 *
 * Written through `createDiveSite`, not an insert: the slug is allocated by
 * the same writer the form uses, and `tideStationConfirmed` goes in false the
 * way a first save does, so the spec's tick is the shop actually answering
 * rather than a fixture pre-answering for them.
 *
 * Idempotent by slug: the route is posted per test and the reset clears
 * `dive_sites` between them, but a test that posts twice must not end up with
 * two sites of the same name in the list it is about to click through.
 */
export async function addASiteItsStationIsNowhereNear(
  db: AppDb,
  shopId: string,
): Promise<{ siteId: string; name: string; slug: string }> {
  const name = "Flower Garden Banks — East Bank";
  const [existing] = await db
    .select({ id: diveSites.id, name: diveSites.name, slug: diveSites.slug })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), eq(diveSites.name, name)))
    .limit(1);
  if (existing) return { siteId: existing.id, name: existing.name, slug: existing.slug };

  const site = await createDiveSite(db, {
    shopId,
    name,
    locationName: "Gulf of Mexico, 100 nm off Galveston",
    forecastLatitude: 27.8825,
    forecastLongitude: -93.8158,
    // Any seven-digit id: the fixture answers Carysfort for all of them, and
    // this is Galveston Pier 21, which is the station a shop out there would
    // genuinely pick.
    tideStationId: "8771450",
  });
  return { siteId: site.id, name: site.name, slug: site.slug };
}
