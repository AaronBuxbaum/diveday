import { describe, expect, it } from "vitest";
import { FEATURE_PAGE_SLUGS } from "./feature-pages";
import { publicRouteShape } from "./public-route-shape";

const SHOP = "blue-mantis";
const TRIP_ID = "11111111-2222-4333-8444-555555555555";

describe("publicRouteShape", () => {
  it("has no opinion about anything outside the public namespace", () => {
    expect(publicRouteShape("/")).toBeNull();
    expect(publicRouteShape("/s")).toBeNull();
    expect(publicRouteShape("/shop/blue-mantis")).toBeNull();
    expect(publicRouteShape("/shop/blue-mantis/trips/nope")).toBeNull();
    expect(publicRouteShape("/api/cron/retention")).toBeNull();
    expect(publicRouteShape("/waivers/some-token")).toBeNull();
  });

  it("reads the storefront itself, with or without a trailing slash", () => {
    const shape = { kind: "shop", shopSlug: SHOP };
    expect(publicRouteShape(`/s/${SHOP}`)).toEqual(shape);
    expect(publicRouteShape(`/s/${SHOP}/`)).toEqual(shape);
  });

  it("folds every shop-only child onto the one shop lookup", () => {
    for (const child of ["courses", "reviews", "register", "packages", "availability.json"]) {
      expect(publicRouteShape(`/s/${SHOP}/${child}`)).toEqual({ kind: "shop", shopSlug: SHOP });
    }
  });

  it("reads a course page, and does not second-guess the slug's shape", () => {
    expect(publicRouteShape(`/s/${SHOP}/courses/open-water`)).toEqual({
      kind: "course",
      shopSlug: SHOP,
      courseSlug: "open-water",
    });
    // `courses/[slug]/page.tsx` puts the segment straight into the query too.
    // A charset check here that drifted from the minting rule would 404 a
    // course that renders.
    expect(publicRouteShape(`/s/${SHOP}/courses/Open_Water--2`)).toEqual({
      kind: "course",
      shopSlug: SHOP,
      courseSlug: "Open_Water--2",
    });
  });

  it("reads a dive site, and calls a segment that could never have been minted malformed", () => {
    expect(publicRouteShape(`/s/${SHOP}/sites/molasses-reef`)).toEqual({
      kind: "site",
      shopSlug: SHOP,
      siteSlug: "molasses-reef",
    });
    // `parseDiveSiteSlug` is the page's own check — the edge is applying it,
    // not inventing one.
    expect(publicRouteShape(`/s/${SHOP}/sites/Molasses%20Reef`)).toEqual({
      kind: "malformed",
      shopSlug: SHOP,
    });
  });

  it("reads a departure and each of its children off the same id", () => {
    const shape = { kind: "trip", shopSlug: SHOP, tripId: TRIP_ID };
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}`)).toEqual(shape);
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}/calendar`)).toEqual(shape);
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}/arrival-card`)).toEqual(shape);
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}/ready`)).toEqual(shape);
  });

  it("calls an id that is not a uuid malformed rather than putting it in a query", () => {
    // The page's own reason (`uuidParam`): Postgres raises on a malformed uuid
    // literal, so this is a 404 and never a 500.
    expect(publicRouteShape(`/s/${SHOP}/trips/nope`)).toEqual({
      kind: "malformed",
      shopSlug: SHOP,
    });
    expect(publicRouteShape(`/s/${SHOP}/trips/nope/calendar`)).toEqual({
      kind: "malformed",
      shopSlug: SHOP,
    });
  });

  it("knows the widget catalog is a closed list", () => {
    expect(publicRouteShape(`/s/${SHOP}/embed/grid`)).toEqual({ kind: "shop", shopSlug: SHOP });
    expect(publicRouteShape(`/s/${SHOP}/embed/departure`)).toEqual({
      kind: "shop",
      shopSlug: SHOP,
    });
    expect(publicRouteShape(`/s/${SHOP}/embed/nope`)).toEqual({
      kind: "malformed",
      shopSlug: SHOP,
    });
  });

  it("calls the framed pages' own segments malformed, because nobody may ask for one by name", () => {
    // `src/proxy.ts` rewrites `?embed=1` onto these and refuses them by path
    // (`isInternalEmbedRoute`) before it asks for a shape; said again here so
    // this function stays true on its own terms, and so the route tree's
    // coverage guard has an opinion to read.
    const malformed = { kind: "malformed", shopSlug: SHOP };
    expect(publicRouteShape(`/s/${SHOP}/embed/schedule`)).toEqual(malformed);
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}/embed`)).toEqual(malformed);
  });

  it("has no opinion about a path in the namespace that names no route at all", () => {
    // Next already answers these with a real 404 of its own; asking the
    // database about them would buy nothing and cost a read.
    expect(publicRouteShape(`/s/${SHOP}/no-such-page`)).toBeNull();
    expect(publicRouteShape(`/s/${SHOP}/embed`)).toBeNull();
    expect(publicRouteShape(`/s/${SHOP}/opengraph-image`)).toBeNull();
    expect(publicRouteShape(`/s/${SHOP}/trips/${TRIP_ID}/opengraph-image`)).toBeNull();
    expect(publicRouteShape(`/s/${SHOP}/courses/open-water/extra`)).toBeNull();
    expect(publicRouteShape(`/s/${SHOP}/sites/molasses-reef/extra`)).toBeNull();
  });

  it("asks about the shop the page would have rendered, not the bytes in the URL", () => {
    // Next hands a page its params decoded; `nextUrl.pathname` is not. A slug
    // that only differs by an escape is the same shop.
    expect(publicRouteShape("/s/blue%2Dmantis")).toEqual({ kind: "shop", shopSlug: SHOP });
  });

  it("declines to refuse a pathname it cannot decode", () => {
    expect(publicRouteShape("/s/%E0%A4%A")).toBeNull();
  });

  it("does not hold a shop slug to a charset the page never applies", () => {
    // `onboardSchema` accepts `[a-z0-9-]+`, which admits a doubled hyphen and
    // an edge one. The row decides whether the shop exists; a regex here would
    // take a live storefront off the internet.
    for (const slug of ["blue--mantis", "-reef", "reef-"]) {
      expect(publicRouteShape(`/s/${slug}`)).toEqual({ kind: "shop", shopSlug: slug });
    }
  });

  /**
   * The three dynamic routes outside `/s/**` (issue #1734), each judged against
   * its own page's own list. Two of them settle here; the third cannot, and the
   * assertion below that says so is the one a shape-only fix would have passed.
   */
  it("refuses an incumbent with no guide, and has no opinion about one that has a page", () => {
    expect(publicRouteShape("/switching/checkfront")).toEqual({ kind: "absent" });
    // `getMigrationGuide` is the page's own check, so every registered guide is
    // served untouched — a refusal here would be a shipped page taken off the
    // internet.
    for (const slug of ["eve", "diveshop360", "smartwaiver", "fareharbor", "rezdy"]) {
      expect(publicRouteShape(`/switching/${slug}`), slug).toBeNull();
    }
    // The hub and the spreadsheet guide are their own static routes, and this
    // module must not mistake either for an unregistered incumbent: the
    // spreadsheet guide is a shipped page whose slug is deliberately not in
    // `MIGRATION_GUIDE_SLUGS` because a spreadsheet is not an incumbent.
    expect(publicRouteShape("/switching")).toBeNull();
    expect(publicRouteShape("/switching/spreadsheet")).toBeNull();
  });

  it("refuses a feature page that does not exist, and has no opinion about one that does", () => {
    // `getFeaturePage` is the page's own check (src/lib/feature-pages.ts), so
    // every registered page is served untouched and anything else is a real
    // 404 before the shell streams.
    expect(publicRouteShape("/product/kiosk")).toEqual({ kind: "absent" });
    expect(publicRouteShape("/product/Waivers")).toEqual({ kind: "absent" });
    for (const slug of FEATURE_PAGE_SLUGS) {
      expect(publicRouteShape(`/product/${slug}`), slug).toBeNull();
    }
    // The hub is its own static route.
    expect(publicRouteShape("/product")).toBeNull();
    expect(publicRouteShape("/product/waivers/extra")).toBeNull();
  });

  it("refuses a feature slug that only an object's prototype would answer", () => {
    // Safe because the registry is a `Map`, which never walks the prototype
    // chain. Rewritten as a plain-object index, `/product/constructor` would
    // pass the edge and render a soft 200 (security review, 2026-10-05).
    for (const slug of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(publicRouteShape(`/product/${slug}`), slug).toEqual({ kind: "absent" });
    }
  });

  it("judges a feature slug after decoding it, as the page does", () => {
    // The path is split before it is decoded, so an escaped slash cannot
    // smuggle a second segment past the list, and an escaped letter is the
    // page it spells.
    expect(publicRouteShape("/product/w%61ivers")).toBeNull();
    expect(publicRouteShape("/product/waivers%2Fx")).toEqual({ kind: "absent" });
  });

  it("has no opinion about anything below the guides", () => {
    // A deeper path names no route at all — Next answers it with a real 404
    // without being asked.
    expect(publicRouteShape("/switching/eve/extra")).toBeNull();
  });

  it("names the shop on a malformed shape too, so the refusal keeps its frame", () => {
    // The proxy frames a refusal as the shop the URL sat under (issue #765).
    // It used to recover that slug by re-parsing the pathname, which decoded
    // nothing and applied a charset narrower than the minting rule; the shape
    // carries the slug the lookup actually used instead.
    expect(publicRouteShape("/s/blue--mantis/trips/nope")).toEqual({
      kind: "malformed",
      shopSlug: "blue--mantis",
    });
    expect(publicRouteShape("/s/blue%2Dmantis/sites/Molasses%20Reef")).toEqual({
      kind: "malformed",
      shopSlug: "blue-mantis",
    });
  });
});
