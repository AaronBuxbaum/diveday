import { describe, expect, it } from "vitest";
import {
  BASEMAP_IMAGERY_URL,
  BASEMAP_TILE_HOSTS,
  routeFrameBounds,
  VECTOR_LABEL_HOSTS,
  vectorLabelsStyleUrl,
} from "./basemap";
import { osmCoordsEmbedUrl } from "./maps";

describe("routeFrameBounds", () => {
  // A route stored before the shared basemap was drawn over the
  // OpenStreetMap embed of this box; the new frame has to be the same box.
  it("frames the box the OpenStreetMap embed framed", () => {
    const [[south, west], [north, east]] = routeFrameBounds(25.0106, -80.3756, 16);
    const bbox = new URL(osmCoordsEmbedUrl("25.0106,-80.3756", 16)).searchParams.get("bbox");
    expect(bbox?.split(",").map(Number)).toEqual(
      [west, south, east, north].map((value) => Number(value.toFixed(5))),
    );
  });

  it("is twice as wide as it is tall in degrees, centred on the site", () => {
    const [[south, west], [north, east]] = routeFrameBounds(12.15, -68.28, 12);
    expect(east - west).toBeCloseTo(2 * (north - south));
    expect((east + west) / 2).toBeCloseTo(-68.28);
    expect((north + south) / 2).toBeCloseTo(12.15);
  });
});

describe("basemap tiles", () => {
  it("come from the one tile host the CSP allows", () => {
    expect(new URL(BASEMAP_IMAGERY_URL.replace(/[{}]/g, "")).origin).toBe(BASEMAP_TILE_HOSTS[0]);
  });

  it("ask for the vector label style from a host the CSP allows, key encoded", () => {
    const url = new URL(vectorLabelsStyleUrl("a&b"));
    expect(VECTOR_LABEL_HOSTS).toContain(url.origin);
    expect(url.searchParams.get("token")).toBe("a&b");
    expect(url.pathname).toMatch(/\/arcgis\/imagery\/labels$/);
  });
});
