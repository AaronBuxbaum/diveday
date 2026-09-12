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
    expect(publicRouteShape(`/s/${SHOP}/sites/Molasses%20Reef`)).toEqual({ kind: "malformed" });
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
    expect(publicRouteShape(`/s/${SHOP}/trips/nope`)).toEqual({ kind: "malformed" });
    expect(publicRouteShape(`/s/${SHOP}/trips/nope/calendar`)).toEqual({ kind: "malformed" });
    expect(publicRouteShape(`/s/${SHOP}/boats/nope`)).toEqual({ kind: "malformed" });
  });

  it("knows the widget catalogue is a closed list", () => {
    expect(publicRouteShape(`/s/${SHOP}/embed/grid`)).toEqual({ kind: "shop", shopSlug: SHOP });
    expect(publicRouteShape(`/s/${SHOP}/embed/departure`)).toEqual({
      kind: "shop",
      shopSlug: SHOP,
    });
    expect(publicRouteShape(`/s/${SHOP}/embed/nope`)).toEqual({ kind: "malformed" });
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
    // `onboardSchema` accepts `[a-z0-9-]+`, which admits a doubled hyphen that
    // `SHOP_SLUG` in public-routes.ts rejects. The row decides whether the
    // shop exists; a regex here would take a live storefront off the internet.
    expect(publicRouteShape("/s/blue--mantis")).toEqual({
      kind: "shop",
      shopSlug: "blue--mantis",
    });
  });
});
