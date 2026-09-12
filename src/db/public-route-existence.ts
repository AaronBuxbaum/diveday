/**
 * **Does this `/s/**` URL name anything?** — the database half of the public
 * namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * `src/lib/public-route-shape.ts` reads the pathname and says which question
 * to ask; this file asks it, from `src/proxy.ts`, before any static shell has
 * gone out. One indexed read for a shop-only route, two for a route that names
 * a course, a dive site or a departure inside a shop.
 *
 * ## The invariant, applied to predicates
 *
 * The rule and the reason behind it are stated once, on `publicRouteShape` —
 * **the edge may never refuse what the page would have served.** There it
 * governs which segments are judged by shape; here it governs which predicates
 * a lookup is allowed to carry. So every reader below is the *page's own*
 * reader, not a hand-written join that could forget a tenant scope or a
 * soft-delete predicate, and every "should this be visible?" question is
 * deliberately left where it already lives, in the page:
 *
 * - a course is looked up without `isActive`, because
 *   `courses/[slug]/page.tsx` serves an inactive course to a staff previewer;
 * - a departure is looked up without status and without `isPrivate`, because a
 *   cancelled one gets its own soft landing at 200 and a shop with the boat
 *   line switched off answers `notFound()` on purpose — but *with* `liveTrip()`,
 *   because every public reader of a departure carries it and 404s a removed
 *   one anyway, so the filter matches the page rather than overruling it
 *   (`tripExistsForShop` states the whole of that reasoning);
 * - a shop that opted out of search listing is still a shop — only
 *   `availability.json` and the year card refuse it, and both do so themselves.
 *
 * Every row this file finds still meets its page's own `notFound()` a moment
 * later. It only removes the cases where there was never a row at all.
 */

import type { PublicRouteShape } from "@/lib/public-route-shape";
import type { AppDb } from "./client";
import { getCourseBySlug } from "./courses";
import { getDiveSiteBySlug } from "./dive-sites";
import { shopIdBySlug } from "./shops";
import { tripExistsForShop } from "./trips-record";

export async function publicRouteExists(db: AppDb, shape: PublicRouteShape): Promise<boolean> {
  // A segment that could never have been minted names nothing, and asking
  // Postgres about it would only be a slower way to learn that.
  if (shape.kind === "malformed") return false;
  const shopId = await shopIdBySlug(db, shape.shopSlug);
  if (!shopId) return false;
  switch (shape.kind) {
    case "shop":
      return true;
    case "course":
      return (await getCourseBySlug(db, shopId, shape.courseSlug)) !== null;
    case "site":
      return (await getDiveSiteBySlug(db, shopId, shape.siteSlug)) !== null;
    case "trip":
      return await tripExistsForShop(db, shopId, shape.tripId);
  }
}
