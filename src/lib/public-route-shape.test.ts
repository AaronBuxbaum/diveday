import { describe, expect, it } from "vitest";
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
    for (const child of ["courses", "reviews", "register", "availability.json", "year-card"]) {
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
    expect(publicRouteShape(`/s/${SHOP}/boats/${TRIP_ID}`)).toEqual(shape);
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
    expect(publicRouteShape(`/s/${SHOP}/boats/nope`)).toEqual({
      kind: "malformed",
      shopSlug: SHOP,
    });
  });

  it("knows the widget catalogue is a closed list", () => {
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

  it("refuses an unknown demo story and passes the three that exist", () => {
    expect(publicRouteShape("/demo/not-a-story")).toEqual({ kind: "absent" });
    for (const story of ["first-booking", "returning-diver", "weather-day"]) {
      expect(publicRouteShape(`/demo/${story}`), story).toBeNull();
    }
  });

  it("refuses a town segment no locality could have produced, with no query", () => {
    // `isRegionSlug` is the page's own first refusal (`dive/[region]/page.tsx`),
    // and it is a *pattern*: this is the half of the region question that is
    // free.
    for (const segment of ["Key%20Largo", "key_largo", "-key-largo", "key-largo-"]) {
      expect(publicRouteShape(`/dive/${segment}`), segment).toEqual({ kind: "absent" });
    }
  });

  it("sends a well-shaped town to the database rather than calling it absent", () => {
    // **The assertion a shape-only fix fails.** There is no closed list of
    // towns — the set is a projection of `shops.region_slug` — so
    // `/dive/not-a-town` passes every pattern check there is and the row has to
    // decide. A module that answered `absent` here would 404 Key Largo.
    expect(publicRouteShape("/dive/not-a-town")).toEqual({
      kind: "region",
      regionSlug: "not-a-town",
    });
    expect(publicRouteShape("/dive/key-largo")).toEqual({
      kind: "region",
      regionSlug: "key-largo",
    });
  });

  it("has no opinion about the indexes above these routes, or anything below them", () => {
    // `/dive` and `/demo` are static routes of their own, and a deeper path
    // under any of the three names no route at all — Next answers those with a
    // real 404 without being asked.
    for (const path of [
      "/dive",
      "/dive/key-largo/extra",
      "/demo",
      "/demo/weather-day/extra",
      "/switching/eve/extra",
    ]) {
      expect(publicRouteShape(path), path).toBeNull();
    }
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
