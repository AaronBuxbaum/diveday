/**
 * Pure pathname classifier for the public namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge). It performs no I/O and
 * must never reject a path its page would serve. Unrecognized routes outside
 * `/s/**` return `null`; unmatched storefront paths with a shop slug return
 * `malformed` and retain that decoded slug. Closed-list misses return `absent`,
 * already a verdict that cannot reach `PublicRouteQuery`. The route-tree
 * coverage test must learn every dynamic public route.
 */

import { parseDiveSiteSlug } from "./dive-site-slug";
import { EMBEDDED_TRIP_SEGMENT, isEmbedWidget } from "./embed-routes";
import { getFeaturePage } from "./feature-pages";
import { getMigrationGuide } from "./migration-guides";
import { PUBLIC_SHOP_PREFIX } from "./public-routes";
import { uuidParam } from "./uuid";

export type PublicRouteShape =
  | { kind: "shop"; shopSlug: string }
  | { kind: "course"; shopSlug: string; courseSlug: string }
  | { kind: "site"; shopSlug: string; siteSlug: string }
  | { kind: "trip"; shopSlug: string; tripId: string }
  | { kind: "malformed"; shopSlug: string }
  /** Judged against a closed list here and absent from it. Already an answer. */
  | { kind: "absent" };

/** Queryable shapes; `absent` is already settled without database access. */
export type PublicRouteQuery = Exclude<PublicRouteShape, { kind: "absent" }>;

/** The shared verdict for "this names nothing, and no shop frames it." */
const ABSENT: PublicRouteShape = { kind: "absent" };

/** Routes whose existence depends only on the shop row. */
const SHOP_ONLY_CHILDREN = new Set([
  "courses",
  "reviews",
  "register",
  "packages",
  "availability.json",
]);

/** Trip child routes that resolve through the departure row. */
const TRIP_CHILDREN = new Set(["calendar", "arrival-card", "ready"]);

export function publicRouteShape(pathname: string): PublicRouteShape | null {
  let segments: string[];
  try {
    // Match Next's decoded page params; malformed escapes pass through.
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [namespace, ...rest] = segments;
  if (!namespace) return null;
  return namespace === SHOP_NAMESPACE ? shopNamespaceShape(rest) : closedListShape(namespace, rest);
}

/** `PUBLIC_SHOP_PREFIX` as a path *segment* — this module works in segments. */
const SHOP_NAMESPACE = PUBLIC_SHOP_PREFIX.slice(1);

/** Classify closed-list guide and feature routes without a database query. */
function closedListShape(namespace: string, rest: string[]): PublicRouteShape | null {
  if (rest.length !== 1) return null;
  const [candidate] = rest;
  if (!candidate) return null;
  // Next's static sibling wins over the dynamic route and must pass through.
  if (STATIC_SIBLINGS.has(`${namespace}/${candidate}`)) return null;
  if (namespace === "switching") return getMigrationGuide(candidate) ? null : ABSENT;
  if (namespace === "product") return getFeaturePage(candidate) ? null : ABSENT;
  return null;
}

/** Real pages that sit where a closed-list segment would otherwise be read. */
const STATIC_SIBLINGS = new Set(["switching/spreadsheet"]);

/** Next image routes, including hashed variants, pass through the edge gate. */
const isPreviewImage = (segment: string | undefined) =>
  segment?.startsWith("opengraph-image") ?? false;

/** Everything below `/s` — the shop's own storefront, where every segment is a row. */
function shopNamespaceShape(segments: string[]): PublicRouteShape | null {
  const [shopSlug, ...rest] = segments;
  if (!shopSlug) return null;
  const shop = { kind: "shop", shopSlug } as const;
  // Unknown storefront routes are malformed so 404s retain the shop frame.
  const unrouted = { kind: "malformed", shopSlug } as const;
  const [first, second, third] = rest;

  if (rest.length === 0) return shop;
  if (rest.length === 1) {
    if (isPreviewImage(first)) return null;
    return first && SHOP_ONLY_CHILDREN.has(first) ? shop : unrouted;
  }
  if (rest.length === 2 && second) {
    if (first === "courses") return { kind: "course", shopSlug, courseSlug: second };
    if (first === "sites") {
      const siteSlug = parseDiveSiteSlug(second);
      return siteSlug ? { kind: "site", shopSlug, siteSlug } : { kind: "malformed", shopSlug };
    }
    if (first === "trips") return tripShape(shopSlug, second);
    // Unknown widgets are normally refused earlier by the proxy.
    if (first === "embed") return isEmbedWidget(second) ? shop : { kind: "malformed", shopSlug };
    return unrouted;
  }
  // The proxy handles this internal embed route before shape lookup.
  if (rest.length === 3 && first === "trips" && third === EMBEDDED_TRIP_SEGMENT) {
    return { kind: "malformed", shopSlug };
  }
  if (rest.length === 3 && first === "trips" && second && third && TRIP_CHILDREN.has(third)) {
    return tripShape(shopSlug, second);
  }
  if (rest.length === 3 && first === "trips" && isPreviewImage(third)) return null;
  return unrouted;
}

/**
 * A departure id, held to the same `uuidParam` its pages hold it to — the
 * check that exists because Postgres raises rather than coerces on a malformed
 * uuid literal, so an unparseable id is a 404 and never a 500.
 */
function tripShape(shopSlug: string, candidate: string): PublicRouteShape {
  const tripId = uuidParam(candidate);
  return tripId ? { kind: "trip", shopSlug, tripId } : { kind: "malformed", shopSlug };
}
