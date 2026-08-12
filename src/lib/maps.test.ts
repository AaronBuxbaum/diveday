import { describe, expect, it } from "vitest";
import { googleMapEmbedUrl, googleMapsUrl, googleTerrainEmbedUrl } from "./maps";

describe("googleTerrainEmbedUrl", () => {
  it("centres on the coordinates instead of searching for them", () => {
    // `ll=` is load-bearing rather than stylistic: `q=` makes the embed a
    // *search*, and Google answers a search by dropping its pin dead centre of
    // the frame — which is exactly where the shop's route is drawn. This test
    // is here because reverting to `q=` looks harmless and silently puts the
    // pin back on top of every route.
    const url = googleTerrainEmbedUrl("25.0106,-80.3756", 16);
    expect(url).toContain("ll=25.0106%2C-80.3756");
    expect(url).not.toContain("q=");
  });

  it("asks for the base map rather than imagery, and carries the zoom it was given", () => {
    // `t=p` resolves to "not satellite" (see the note in maps.ts), and the zoom
    // has to survive into the URL: a route is percentages of a frame at a
    // stored zoom, so a dropped `z` draws the line over the wrong water.
    const url = googleTerrainEmbedUrl("25.0106,-80.3756", 18);
    expect(url).toContain("t=p");
    expect(url).toContain("z=18");
  });
});

describe("googleMapEmbedUrl", () => {
  it("keeps its pin, because a shop's address is the answer to a search", () => {
    const url = googleMapEmbedUrl("12 Dock Road, Key Largo FL");
    expect(url).toContain("q=12%20Dock%20Road%2C%20Key%20Largo%20FL");
  });
});

describe("googleMapsUrl", () => {
  it("hands the reader's own maps app the same query", () => {
    expect(googleMapsUrl("25.0106,-80.3756")).toBe(
      "https://www.google.com/maps/search/?api=1&query=25.0106%2C-80.3756",
    );
  });
});
