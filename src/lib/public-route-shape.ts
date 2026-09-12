/**
 * **What a `/s/**` URL claims to name**, read off the pathname alone.
 *
 * The pure half of the public namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge): under `cacheComponents`
 * every page in this namespace streams a static shell first, so a `notFound()`
 * in the page body arrives after the 200 has gone out and a crawler reads a
 * soft 404. The status has to be decided before anything streams, which means
 * in `src/proxy.ts` — and the proxy has no `params`, only a pathname. This
 * module turns that pathname into the question the database can answer, and
 * `src/db/public-route-existence.ts` answers it.
 *
 * No I/O, nothing from `src/db`: the split is what lets every routing rule here
 * be pinned by a unit test that never opens a database.
 *
 * ## The invariant, and it is the whole design
 *
 * **The edge may never refuse what the page would have served.** A soft 404 on
 * a dead link is a bug; a hard 404 on a live shop is an outage. So the only
 * segments this module judges by *shape* are the two the pages themselves
 * already judge by shape before they query — a dive-site slug through
 * `parseDiveSiteSlug` (`sites/[siteSlug]/page.tsx`) and a trip id through
 * `uuidParam` (`trips/[id]/page.tsx`, `boats/[tripId]/page.tsx`) — plus the
 * embed catalogue, whose widget names are a closed list in this repository
 * rather than a row. A shop slug and a course slug are *not* pattern-checked
 * here even though both are minted from a known charset: the page does not
 * check them either, it just looks them up, and a slug charset that drifts
 * apart from the minting rule (`onboardSchema` accepts `[a-z0-9-]+`, which
 * admits `blue--mantis`, while the matcher in `public-routes.ts` does not)
 * would turn a real shop's whole storefront into a 404. The row decides.
 *
 * `null` means "this module has no opinion" — the URL is outside the
 * namespace, or names no route in it at all, which Next already answers with a
 * real 404 of its own. `{ kind: "malformed" }` means "this names nothing and
 * cannot name anything", which needs no query.
 */

import { parseDiveSiteSlug } from "./dive-site-slug";
import { isEmbedWidget } from "./embed-routes";
import { PUBLIC_SHOP_PREFIX } from "./public-routes";
import { uuidParam } from "./uuid";

export type PublicRouteShape =
  | { kind: "shop"; shopSlug: string }
  | { kind: "course"; shopSlug: string; courseSlug: string }
  | { kind: "site"; shopSlug: string; siteSlug: string }
  | { kind: "trip"; shopSlug: string; tripId: string }
  | { kind: "malformed" };

/**
 * Routes below `/s/<shopSlug>` that name nothing but the shop — the course
 * catalogue, the review archive, the counter's self-registration door, the
 * availability document and the year card. Each 404s only when the shop does,
 * so each folds to one lookup.
 */
const SHOP_ONLY_CHILDREN = new Set([
  "courses",
  "reviews",
  "register",
  "availability.json",
  "year-card",
]);

/**
 * The children of one departure that live under its own id: the `.ics`
 * download, the diver's arrival card, and the readiness hop. Each resolves the
 * same trip, so each asks the same question.
 */
const TRIP_CHILDREN = new Set(["calendar", "arrival-card", "ready"]);

export function publicRouteShape(pathname: string): PublicRouteShape | null {
  if (!pathname.startsWith(`${PUBLIC_SHOP_PREFIX}/`)) return null;
  let segments: string[];
  try {
    // Next hands a page its `params` percent-decoded; `nextUrl.pathname` is
    // not. Decoding here is what keeps `/s/blue%2Dmantis` asking about the
    // same shop the page would have rendered. A malformed escape decodes to
    // nothing at all, and that is a request this module declines to have an
    // opinion about rather than one it refuses.
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [, shopSlug, ...rest] = segments;
  if (!shopSlug) return null;
  const shop = { kind: "shop", shopSlug } as const;
  const [first, second, third] = rest;

  if (rest.length === 0) return shop;
  if (rest.length === 1) return first && SHOP_ONLY_CHILDREN.has(first) ? shop : null;
  if (rest.length === 2 && second) {
    if (first === "courses") return { kind: "course", shopSlug, courseSlug: second };
    if (first === "sites") {
      const siteSlug = parseDiveSiteSlug(second);
      return siteSlug ? { kind: "site", shopSlug, siteSlug } : { kind: "malformed" };
    }
    if (first === "trips" || first === "boats") return tripShape(shopSlug, second);
    // The proxy answers an unknown widget before it ever asks for a shape
    // (`isUnknownEmbedWidgetRoute`), because that refusal needs no shop. Said
    // again here so this function stays true on its own terms rather than by
    // an ordering two files away.
    if (first === "embed") return isEmbedWidget(second) ? shop : { kind: "malformed" };
    return null;
  }
  if (rest.length === 3 && first === "trips" && second && third && TRIP_CHILDREN.has(third)) {
    return tripShape(shopSlug, second);
  }
  return null;
}

/**
 * A departure id, held to the same `uuidParam` its pages hold it to — the
 * check that exists because Postgres raises rather than coerces on a malformed
 * uuid literal, so an unparseable id is a 404 and never a 500.
 */
function tripShape(shopSlug: string, candidate: string): PublicRouteShape {
  const tripId = uuidParam(candidate);
  return tripId ? { kind: "trip", shopSlug, tripId } : { kind: "malformed" };
}
