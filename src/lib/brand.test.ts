import { describe, expect, it } from "vitest";
import {
  BRAND_BADGE_CODES,
  BRAND_DEFAULT_GROUND,
  BRAND_DISPLAY_FONT_CODES,
  brandDisplayFontFamily,
  brandDisplayFontStylesheet,
  brandThemeProperties,
  contrastRatio,
  deriveBrandTheme,
  parseBrandBadges,
  parseBrandColor,
} from "./brand";

describe("parseBrandColor", () => {
  it("stores one shape — #rrggbb, lowercase — from the shapes a form sends", () => {
    expect(parseBrandColor("#178F6A")).toEqual({ value: "#178f6a", valid: true });
    expect(parseBrandColor("178f6a")).toEqual({ value: "#178f6a", valid: true });
    expect(parseBrandColor("  #0E7490 ")).toEqual({ value: "#0e7490", valid: true });
  });

  it("reads blank as no brand colour, and anything else as a refusal", () => {
    expect(parseBrandColor("")).toEqual({ value: null, valid: true });
    expect(parseBrandColor(null)).toEqual({ value: null, valid: true });
    expect(parseBrandColor("#fff")).toEqual({ value: null, valid: false });
    expect(parseBrandColor("teal")).toEqual({ value: null, valid: false });
    expect(parseBrandColor("#12345g")).toEqual({ value: null, valid: false });
  });
});

describe("parseBrandBadges", () => {
  it("keeps the shop's order, drops strangers and collapses repeats", () => {
    expect(parseBrandBadges(["blue_star", "padi_5_star", "blue_star", "made_up"])).toEqual([
      "blue_star",
      "padi_5_star",
    ]);
    expect(parseBrandBadges("padi_5_star")).toEqual([]);
  });

  it("names every code once", () => {
    expect(new Set(BRAND_BADGE_CODES).size).toBe(BRAND_BADGE_CODES.length);
    expect(new Set(BRAND_DISPLAY_FONT_CODES).size).toBe(BRAND_DISPLAY_FONT_CODES.length);
  });
});

describe("display faces", () => {
  it("gives every face a family with a fallback stack and one stylesheet", () => {
    for (const code of BRAND_DISPLAY_FONT_CODES) {
      expect(brandDisplayFontFamily(code)).toMatch(/^'.+', .+/);
      expect(brandDisplayFontStylesheet(code)).toMatch(
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=.+&display=swap$/,
      );
    }
  });
});

/**
 * The derivation rule is the safety half of Harbor: a shop may pick any colour,
 * and the storefront still has to read. Each branch of the rule has a colour
 * that exercises it.
 */
describe("deriveBrandTheme", () => {
  it("keeps a colour that already reads as text on sand, with white as its ink", () => {
    const theme = deriveBrandTheme("#0E7490");
    expect(theme.primary).toBe("#0e7490");
    expect(theme.primaryForeground).toBe("#ffffff");
    expect(theme.adjusted).toBe(false);
  });

  it("darkens a colour white reads on but sand does not, and says so", () => {
    // The seeded demo green: 5.4:1 under white text, 4.36:1 as a link on
    // sand and 4.03:1 as the selected pill's words over its own tint — the
    // pair the 2026-09-02 a11y run failed 22 surfaces on. One 8% step.
    const theme = deriveBrandTheme("#158462");
    expect(theme.adjusted).toBe(true);
    expect(theme.primary).toBe("#13795a");
    expect(contrastRatio(theme.primary, BRAND_DEFAULT_GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.primary, theme.primaryTint)).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a pale colour rather than keeping it: a pale colour cannot be a link", () => {
    const theme = deriveBrandTheme("#f7e26b");
    expect(theme.adjusted).toBe(true);
    expect(theme.primary).not.toBe("#f7e26b");
    expect(theme.primaryForeground).toBe("#ffffff");
    expect(contrastRatio(theme.primary, BRAND_DEFAULT_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a colour neither text reads on until white does, and says so", () => {
    const theme = deriveBrandTheme("#d9534f");
    expect(theme.adjusted).toBe(true);
    expect(theme.primary).not.toBe("#d9534f");
    expect(theme.primaryForeground).toBe("#ffffff");
    expect(contrastRatio(theme.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("always reads as text on the ground and its tint, and as a fill under its ink, whatever the colour", () => {
    for (const color of [
      "#ffffff",
      "#000000",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#808080",
      "#ffff00",
      "#158462",
    ]) {
      const theme = deriveBrandTheme(color);
      expect(contrastRatio(theme.primary, BRAND_DEFAULT_GROUND)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, theme.primaryTint)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, theme.primaryForeground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("hovers darker and tints toward the surface", () => {
    const theme = deriveBrandTheme("#178f6a", { surface: "#fffdf8" });
    expect(contrastRatio(theme.primaryHover, "#ffffff")).toBeGreaterThan(
      contrastRatio(theme.primary, "#ffffff"),
    );
    expect(contrastRatio(theme.primaryTint, "#fffdf8")).toBeLessThan(1.4);
  });

  it("emits exactly the properties the public layout sets", () => {
    expect(Object.keys(brandThemeProperties(deriveBrandTheme("#178f6a")))).toEqual([
      "--primary",
      "--primary-hover",
      "--primary-tint",
      "--primary-foreground",
      "--focus-ring",
    ]);
  });
});
