import { describe, expect, it } from "vitest";
import { contrastRatio } from "./brand";
import { yearCardPalette } from "./year-card";

describe("yearCardPalette", () => {
  it.each([
    ["white", "#ffffff", "#16232c"],
    ["pale", "#fdf1b3", "#16232c"],
    ["saturated", "#ffeb3b", "#16232c"],
    ["dark", "#111827", "#fffdf8"],
    ["DiveDay default", null, "#fffdf8"],
  ])("keeps its reading ink legible on %s brand colors", (_name, brandColor, expectedInk) => {
    const palette = yearCardPalette(brandColor);

    expect(palette.ink).toBe(expectedInk);
    for (const ground of [palette.near, palette.mid, palette.far]) {
      expect(
        contrastRatio(palette.ink, ground),
        `${palette.ink} on ${ground}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
