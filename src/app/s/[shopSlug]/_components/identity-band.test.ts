import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { identityBand, monthRailSides } from "./identity-band";

const t = diverTranslator("en-US");

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

describe("monthRailSides", () => {
  it("uses the schedule view's month-link builder for both sides", () => {
    const links = monthRailSides(
      "2026-07",
      "2026-09",
      (monthKey) => `/s/blue-mantis?month=${monthKey}&hasSpace=1`,
      t,
    );

    expect(links.previous?.href).toBe("/s/blue-mantis?month=2026-07&hasSpace=1");
    expect(links.next?.href).toBe("/s/blue-mantis?month=2026-09&hasSpace=1");
  });

  it("omits unavailable month sides", () => {
    expect(monthRailSides(null, null, () => "/unreachable", t)).toEqual({
      previous: null,
      next: null,
    });
  });
});
