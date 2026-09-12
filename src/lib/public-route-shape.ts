/**
 * **What a public URL claims to name**, read off the pathname alone.
 *
 * The pure half of the public namespace's edge refusal (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge): under `cacheComponents`
 * every public page streams a static shell first, so a `notFound()`
 * in the page body arrives after the 200 has gone out and a crawler reads a
 * soft 404. The status has to be decided before anything streams, which means
 * in `src/proxy.ts` — and the proxy has no `params`, only a pathname. This
 * module turns that pathname into the question the database can answer, and
 * `src/db/public-route-existence.ts` answers it.
 *
 * No I/O, nothing from `src/db`: the split is what lets every routing rule here
 * be pinned by a unit test that never opens a database.
 *
 * ## Two namespaces, one question
 *
 * `/s/**` is a shop's storefront and every segment in it is a row. The three
 * dynamic routes outside it — `/dive/<town>`, `/switching/<incumbent>`,
 * `/demo/<story>` — were left soft when that namespace was fixed, and answered
 * 200 with a not-found page for six more weeks on two surfaces DiveDay wants
 * indexed (issue #1734). They are judged here too, each against the *very same
 * list its own page judges the segment against*: `getMigrationGuide` and
 * `isDemoStoryId` are closed lists this repository holds, so both settle with
 * no query at all; `isRegionSlug` is only a shape test, so a well-shaped town
 * still goes to the database (there is no closed list of towns — the set is a
 * projection of `shops.region_slug`, and `/dive/not-a-town` passes every
 * pattern check there is).
 *
 * **A route this module does not recognise is passed through untouched**, which
 * is how the three above stayed soft while `/s/**` was hard. So the recognition
 * is pinned to the route tree rather than to memory:
 * `src/app/edge-refusal-coverage.test.ts` walks `src/app` for dynamic public
 * routes and fails on the first one this function has no opinion about. Adding
 * a route is what reminds you.
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
 * apart from the minting rule would turn a real shop's whole storefront into a
 * 404. That drift was real — `onboardSchema` sells `blue--mantis` and
 * `SHOP_SLUG_PATTERN` used to refuse it — and it cost a shop its 404 frame
 * rather than its storefront only because this module never applied it. The
 * row decides.
 *
 * `null` means "this module has no opinion" — the URL is outside the
 * namespace, or names no route in it at all, which Next already answers with a
 * real 404 of its own, or it names a guide or a story that is really there.
 * `{ kind: "malformed" }` means "this names nothing and cannot name anything",
 * which needs no query; `{ kind: "absent" }` is the same verdict for a URL with
 * no shop over it, and it is the one shape that is already an answer rather
 * than a question — `PublicRouteQuery` excludes it so the proxy cannot hand it
 * to a database it never needed to open.
 *
 * **Every shape inside `/s/**` names its shop, `malformed` included.** A
 * refusal is framed as
 * the shop the URL was under (issue #765), and the proxy used to recover that
 * slug by re-reading the pathname through `shopSlugFromPublicPath` — a second
 * parse, undecoded and held to a charset narrower than the minting rule, so a
 * live `blue--mantis` and a live shop reached as `/s/blue%2Dmantis` both lost
 * the frame. The slug this module already decoded and already looked the shop
 * up by is the honest one, so it rides on the shape.
 */

import { isDemoStoryId } from "./demo-stories";
import { parseDiveSiteSlug } from "./dive-site-slug";
import { isEmbedWidget } from "./embed-routes";
import { getMigrationGuide } from "./migration-guides";
import { PUBLIC_SHOP_PREFIX } from "./public-routes";
import { isRegionSlug, REGIONS_PATH } from "./region";
import { uuidParam } from "./uuid";

export type PublicRouteShape =
  | { kind: "shop"; shopSlug: string }
  | { kind: "course"; shopSlug: string; courseSlug: string }
  | { kind: "site"; shopSlug: string; siteSlug: string }
  | { kind: "trip"; shopSlug: string; tripId: string }
  | { kind: "malformed"; shopSlug: string }
  /** A town, which only the listed shops in it can answer for. */
  | { kind: "region"; regionSlug: string }
  /** Judged against a closed list here and absent from it. Already an answer. */
  | { kind: "absent" };

/**
 * The shapes a row still has to answer — every kind except `absent`, which the
 * pure half has already settled. `publicRouteLookup` takes this rather than the
 * full union so a closed-list refusal cannot reach a database by accident: the
 * proxy has to narrow, and the compiler is what makes it.
 */
export type PublicRouteQuery = Exclude<PublicRouteShape, { kind: "absent" }>;

/** The shared verdict for "this names nothing, and no shop frames it." */
const ABSENT: PublicRouteShape = { kind: "absent" };

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
  const [namespace, ...rest] = segments;
  if (!namespace) return null;
  return namespace === SHOP_NAMESPACE ? shopNamespaceShape(rest) : closedListShape(namespace, rest);
}

/** `PUBLIC_SHOP_PREFIX` as a path *segment* — this module works in segments. */
const SHOP_NAMESPACE = PUBLIC_SHOP_PREFIX.slice(1);

/**
 * The three one-segment routes outside `/s/**`, each judged against its own
 * page's own list.
 *
 * The two closed lists settle here: `/switching/checkfront` and
 * `/demo/not-a-story` are refused with no query, and a slug that *is* on the
 * list gets `null` — "no opinion", which is how every live guide and story goes
 * on being served. A town cannot settle here, because `isRegionSlug` is a
 * pattern and not a membership test: the shape half is free (`/dive/Key%20Largo`
 * is refused without a read, exactly as `dive/[region]/page.tsx` refuses it
 * before its own query), and a well-shaped town becomes the one question the
 * database answers.
 *
 * The segment names are literals because neither closed list ships a path
 * constant to import; `src/app/edge-refusal-coverage.test.ts` derives these
 * route paths from the route tree, so a renamed directory turns this red rather
 * than quietly restoring the 200.
 */
function closedListShape(namespace: string, rest: string[]): PublicRouteShape | null {
  if (rest.length !== 1) return null;
  const [candidate] = rest;
  if (!candidate) return null;
  // A static route beside the dynamic one wins in Next's router, so it is a
  // page that renders and the edge must never refuse it. `/switching/spreadsheet`
  // is the live example — a shipped guide whose slug is deliberately not in
  // `MIGRATION_GUIDE_SLUGS`, because it is not an incumbent — and it would have
  // been 404'd by a `[competitor]`-shaped judgement of its path.
  // `src/app/edge-refusal-coverage.test.ts` reads these off the route tree, so
  // the next one cannot be forgotten here.
  if (STATIC_SIBLINGS.has(`${namespace}/${candidate}`)) return null;
  switch (namespace) {
    case REGION_NAMESPACE:
      return isRegionSlug(candidate) ? { kind: "region", regionSlug: candidate } : ABSENT;
    case "switching":
      return getMigrationGuide(candidate) ? null : ABSENT;
    case "demo":
      return isDemoStoryId(candidate) ? null : ABSENT;
    default:
      return null;
  }
}

const REGION_NAMESPACE = REGIONS_PATH.slice(1);

/** Real pages that sit where a closed-list segment would otherwise be read. */
const STATIC_SIBLINGS = new Set(["switching/spreadsheet"]);

/** Everything below `/s` — the shop's own storefront, where every segment is a row. */
function shopNamespaceShape(segments: string[]): PublicRouteShape | null {
  const [shopSlug, ...rest] = segments;
  if (!shopSlug) return null;
  const shop = { kind: "shop", shopSlug } as const;
  const [first, second, third] = rest;

  if (rest.length === 0) return shop;
  if (rest.length === 1) return first && SHOP_ONLY_CHILDREN.has(first) ? shop : null;
  if (rest.length === 2 && second) {
    if (first === "courses") return { kind: "course", shopSlug, courseSlug: second };
    if (first === "sites") {
      const siteSlug = parseDiveSiteSlug(second);
      return siteSlug ? { kind: "site", shopSlug, siteSlug } : { kind: "malformed", shopSlug };
    }
    if (first === "trips" || first === "boats") return tripShape(shopSlug, second);
    // The proxy answers an unknown widget before it ever asks for a shape
    // (`isUnknownEmbedWidgetRoute`), because that refusal needs no shop. Said
    // again here so this function stays true on its own terms rather than by
    // an ordering two files away.
    if (first === "embed") return isEmbedWidget(second) ? shop : { kind: "malformed", shopSlug };
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
  return tripId ? { kind: "trip", shopSlug, tripId } : { kind: "malformed", shopSlug };
}
