import { describe, expect, it } from "vitest";
import { identityBand } from "./identity-band";

const bare = { brandHeroImageUrl: null, description: null };

describe("the storefront's identity band", () => {
  it("stacks a lone next boat flat under a shop with only a name", () => {
    expect(identityBand(false, true, bare)).toEqual({
      identityPanels: 1,
      panelsBeside: false,
      nextBoatFlat: true,
    });
  });

  it("sits beside a shop with a photograph or a description", () => {
    expect(
      identityBand(false, true, { ...bare, brandHeroImageUrl: "/hero.jpg" }).panelsBeside,
    ).toBe(true);
    expect(identityBand(false, true, { ...bare, description: "Two boats." }).panelsBeside).toBe(
      true,
    );
  });

  it("keeps two panels as cards in a row, not a flat strip", () => {
    expect(identityBand(true, true, bare)).toEqual({
      identityPanels: 2,
      panelsBeside: false,
      nextBoatFlat: false,
    });
  });

  it("has nothing to lay out with no panel", () => {
    expect(identityBand(false, false, bare)).toEqual({
      identityPanels: 0,
      panelsBeside: false,
      nextBoatFlat: false,
    });
  });
});
