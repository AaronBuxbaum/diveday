/**
 * The database half of the public namespace refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge). `publicRouteShape`
 * selects the question; the proxy asks it before sending the public page shell.
 * A closed-list miss never reaches this lookup.
 *
 * The lookup returns both route existence and shop existence so a refusal can
 * render that shop's own 404 (issue #765). It uses each page's reader and scope;
 * canceled or private trips retain their public soft landing, while removed
 * trips are excluded by `liveTrip()`.
 *
 * Hidden courses are reported to the proxy. After a successful existence
 * lookup reports one hidden, the proxy refuses it unless the URL carries the
 * short-lived signed preview capability minted by the editor for live staff of
 * that shop. On a lookup failure the proxy serves the page; its live per-shop
 * staff check remains the content boundary. A bookmarked public URL has no
 * capability and is refused after a successful lookup; staff open Preview from
 * the editor. A missing cookie, a forged cookie value, or a cached session
 * snapshot cannot establish live staff for this shop.
 */

import type { PublicRouteQuery } from "@/lib/public-route-shape";
import { TtlLru } from "@/lib/ttl-lru";
import type { AppDb } from "./client";
import { getCourseBySlug } from "./courses";
import { getDiveSiteBySlug } from "./dive-sites";
import { shopIdBySlug } from "./shops";
import { tripExistsForShop } from "./trips-record";

export type PublicRouteLookup = {
  /** Does the URL name a row? `false` is the refusal. */
  readonly exists: boolean;
  /**
   * Is the shop the URL sat under a real shop? Only the refusal path reads
   * this, and only to frame the 404 as that shop's (issue #765).
   */
  readonly shopExists: boolean;
  /**
   * The row is there, and the shop has it off its public site. Only a course
   * can answer true — it is `courses.is_active`, reported and not applied, so
   * the caller holding the capability decides (issue #1735).
   */
  readonly hidden: boolean;
};

const NOTHING: PublicRouteLookup = { exists: false, shopExists: false, hidden: false };

export async function publicRouteLookup(
  db: AppDb,
  shape: PublicRouteQuery,
): Promise<PublicRouteLookup> {
  const shopId = await shopIdBySlug(db, shape.shopSlug);
  if (!shopId) return NOTHING;
  switch (shape.kind) {
    // A segment that could never have been minted names nothing, and asking
    // Postgres about it would only be a slower way to learn that. The shop
    // read above is still made, and made first: it is what decides whose
    // refusal this is.
    case "malformed":
      return { exists: false, shopExists: true, hidden: false };
    case "shop":
      return { exists: true, shopExists: true, hidden: false };
    case "course": {
      // The page's own reader, unchanged and still carrying no `isActive`
      // predicate. The flag rides back beside the row rather than filtering it
      // out, because the reader who may see past it is the one holding a
      // capability this file knows nothing about.
      const course = await getCourseBySlug(db, shopId, shape.courseSlug);
      return {
        exists: course !== null,
        shopExists: true,
        hidden: course ? !course.isActive : false,
      };
    }
    case "site":
      return {
        exists: (await getDiveSiteBySlug(db, shopId, shape.siteSlug)) !== null,
        shopExists: true,
        hidden: false,
      };
    case "trip":
      return {
        exists: await tripExistsForShop(db, shopId, shape.tripId),
        shopExists: true,
        hidden: false,
      };
  }
}

/** How long an instance believes "this URL names a row" without asking again. */
export const PUBLIC_ROUTE_LOOKUP_TTL_MS = 60_000;
const PUBLIC_ROUTE_LOOKUP_MAX_ENTRIES = 2_000;

const rememberedLookups = new TtlLru<PublicRouteLookup>(
  PUBLIC_ROUTE_LOOKUP_MAX_ENTRIES,
  PUBLIC_ROUTE_LOOKUP_TTL_MS,
);

/**
 * {@link publicRouteLookup} behind a per-instance memory of the answers that
 * said **yes** (app audit 2026-10-07, item 21).
 *
 * `src/proxy.ts` asks this before the static shell of every public `/s/**`
 * document, so without a memory every public page view opened the pool and
 * paid one to two round trips before a byte was sent. Remembering the yeses
 * for {@link PUBLIC_ROUTE_LOOKUP_TTL_MS} takes a busy storefront's repeat
 * views off the database entirely; `open` is only called on a miss, so a warm
 * instance answering a remembered URL never touches the pool at all.
 *
 * **What it is allowed to get wrong, and for how long.** Only a plain yes —
 * `exists`, for a shape that is not a course — is remembered, so:
 *
 * - A shop, departure, course or site created (or a course published) a
 *   moment ago is visible at once. A refusal is never remembered, and neither
 *   is a hidden course, so nothing new waits on a TTL.
 * - **A course is never remembered at all.** Hiding one is a refusal this
 *   layer applies rather than reports (issue #1735), and the editor's own page
 *   links to the public course, so the edge had always just seen it live: a
 *   remembered yes served the freshly hidden draft 200 for a minute.
 * - A shop, departure or site deleted may still pass the edge for up to the
 *   TTL on an instance that saw it live. That is the same
 *   answer the edge gave a minute earlier, and it is not the only gate: the
 *   page's own reader runs its own `notFound()` and its own `isActive` and
 *   staff checks on every render, so the lingering yes buys a dead link the
 *   page's 404 rather than the edge's — never a hidden row.
 *
 * The key is the whole shape, so a course and a site with one slug, or one
 * slug under two shops, never share an entry. A throw is never remembered.
 */
export async function rememberedPublicRouteLookup(
  shape: PublicRouteQuery,
  open: () => Promise<AppDb>,
): Promise<PublicRouteLookup> {
  const key = JSON.stringify(shape);
  const remembered = rememberedLookups.get(key);
  if (remembered) return remembered;
  const lookup = await publicRouteLookup(await open(), shape);
  if (lookup.exists && !lookup.hidden && shape.kind !== "course") {
    rememberedLookups.set(key, lookup);
  }
  return lookup;
}

/** Forget every remembered answer — for tests. */
export function forgetPublicRouteLookups(): void {
  rememberedLookups.clear();
}
