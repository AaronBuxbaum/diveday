import { describe, expect, it } from "vitest";
import { contrastRatio, mixHex } from "./brand";
import { yearCardPalette } from "./year-card";

function compositeMuted(muted: string, ground: string): string {
  const channels = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(muted);
  expect(channels, `${muted} should be an rgba ink`).not.toBeNull();
  const ink = `#${channels
    ?.slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
  return mixHex(ground, ink, Number(channels?.[4]));
}

describe("yearCardPalette", () => {
  it.each([
    ["white", "#ffffff", "#16232c"],
    ["pale", "#fdf1b3", "#16232c"],
    ["saturated", "#ffeb3b", "#16232c"],
    ["saturated red", "#ff0000", "#fffdf8"],
    ["saturated blue", "#0064d2", "#fffdf8"],
    ["dark", "#111827", "#fffdf8"],
    ["gray", "#808080", "#fffdf8"],
    ["DiveDay default", null, "#fffdf8"],
  ])("keeps its reading ink legible on %s brand colors", (_name, brandColor, expectedInk) => {
    const palette = yearCardPalette(brandColor);

    expect(palette.ink).toBe(expectedInk);
    for (const ground of [palette.near, palette.mid, palette.far]) {
      expect(
        contrastRatio(palette.ink, ground),
        `${palette.ink} on ${ground}`,
      ).toBeGreaterThanOrEqual(4.5);
      const muted = compositeMuted(palette.muted, ground);
      expect(
        contrastRatio(muted, ground),
        `composited ${palette.muted} on ${ground} becomes ${muted}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
