import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND_BADGE_CODES,
  BRAND_DARK_GROUND,
  BRAND_DARK_SURFACE,
  BRAND_DEFAULT_SURFACE,
  BRAND_DISPLAY_FONT_CODES,
  BRAND_INK,
  brandDisplayFontFamily,
  brandDisplayFontStylesheet,
  brandThemeProperties,
  contrastRatio,
  deriveBrandTheme,
  deriveDarkBrandTheme,
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
  it("keeps a colour white reads on, with white as its ink", () => {
    const theme = deriveBrandTheme("#0E7490");
    expect(theme.primary).toBe("#0e7490");
    expect(theme.primaryForeground).toBe("#ffffff");
    expect(theme.adjusted).toBe(false);
  });

  /**
   * A pale brand cannot be a link on a cream page, so on the storefront it is
   * darkened until it reads as text; ink-on-pale survives only for a dark
   * surface, where the colour reads as text without moving.
   */
  it("darkens a pale colour until it reads as text on the ground, and says so", () => {
    const theme = deriveBrandTheme("#f7e26b");
    expect(theme.adjusted).toBe(true);
    expect(contrastRatio(theme.primary, BRAND_DEFAULT_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.primary, theme.primaryForeground)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a pale colour on a dark surface and puts ink on it", () => {
    const theme = deriveBrandTheme("#f7e26b", { surface: "#0c2a35" });
    expect(theme.primary).toBe("#f7e26b");
    expect(theme.primaryForeground).toBe(BRAND_INK);
    expect(theme.adjusted).toBe(false);
  });

  /**
   * The failure axe found on 2026-09-02: the demo shop's green read on a white
   * button (5.28:1) but not as a link on the sand ground (4.36:1), and every
   * storefront link failed. The rule now checks the colour as text first.
   */
  it("darkens a colour that reads on white but not as text on the ground", () => {
    const theme = deriveBrandTheme("#158462");
    expect(theme.adjusted).toBe(true);
    expect(contrastRatio(theme.primary, BRAND_DEFAULT_SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.primary, theme.primaryTint)).toBeGreaterThanOrEqual(4.5);
    expect(theme.primaryForeground).toBe("#ffffff");
  });

  it("darkens a colour neither text reads on until white does, and says so", () => {
    const theme = deriveBrandTheme("#d9534f");
    expect(theme.adjusted).toBe(true);
    expect(theme.primary).not.toBe("#d9534f");
    expect(theme.primaryForeground).toBe("#ffffff");
    expect(contrastRatio(theme.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("always ends with a fill its ink reads on, whatever the colour", () => {
    for (const color of [
      "#ffffff",
      "#000000",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#808080",
      "#ffff00",
    ]) {
      const theme = deriveBrandTheme(color);
      expect(contrastRatio(theme.primary, theme.primaryForeground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, BRAND_DEFAULT_SURFACE)).toBeGreaterThanOrEqual(4.5);
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

/**
 * The dark scheme's half of "one colour, two derivations" (issue #1265, ADR
 * 20260901-diveday-reimagined decision 2 as amended 2026-09-02).
 *
 * The bug these pin was invisible for a structural reason: `BrandStyle` emitted
 * one `:root` block that won in both schemes, so every branded storefront wore
 * its light-mode colour at depth — and the a11y sweep scanned light only, so
 * nothing red ever said so.
 */
describe("deriveDarkBrandTheme", () => {
  /** Every ground and wash the dark derivation has to clear, at once. */
  function readsEverywhere(theme: ReturnType<typeof deriveDarkBrandTheme>) {
    return [
      contrastRatio(theme.primary, BRAND_DARK_GROUND),
      contrastRatio(theme.primary, BRAND_DARK_SURFACE),
      contrastRatio(theme.primary, theme.primaryTint),
      contrastRatio(theme.primary, theme.primaryForeground),
    ];
  }

  it("lightens the seeded shop's green until it reads at depth", () => {
    // #158462 is blue-mantis's stored colour; the light derivation makes
    // #13795a of it, which measures 3.39 on the dark ground and 3.05 on the
    // dark shell — the exact numbers in the issue.
    const light = deriveBrandTheme("#158462");
    expect(contrastRatio(light.primary, BRAND_DARK_GROUND)).toBeLessThan(4.5);
    expect(contrastRatio(light.primary, BRAND_DARK_SURFACE)).toBeLessThan(4.5);

    const dark = deriveDarkBrandTheme("#158462");
    expect(dark.adjusted).toBe(true);
    for (const ratio of readsEverywhere(dark)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    // Still recognisably the shop's green, not a wash of white.
    expect(dark.primary).not.toBe("#ffffff");
  });

  it("lightens DiveDay's own lagoon, which is 3.40 at depth", () => {
    expect(contrastRatio(deriveBrandTheme("#0e7490").primary, BRAND_DARK_GROUND)).toBeLessThan(4.5);
    const dark = deriveDarkBrandTheme("#0e7490");
    expect(dark.adjusted).toBe(true);
    for (const ratio of readsEverywhere(dark)) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a pale colour alone — the two derivations move in opposite directions", () => {
    // The case worth having: one input, and the schemes disagree about which
    // way it is wrong. Moccasin already reads at depth and fails on sand.
    const pale = "#ffe4b5";
    const dark = deriveDarkBrandTheme(pale);
    expect(dark.primary).toBe(pale);
    expect(dark.adjusted).toBe(false);

    const light = deriveBrandTheme(pale);
    expect(light.adjusted).toBe(true);
    expect(contrastRatio(light.primary, "#ffffff")).toBeGreaterThan(
      contrastRatio(dark.primary, "#ffffff"),
    );
  });

  it("always ends readable, whatever the colour", () => {
    for (const color of [
      "#ffffff",
      "#000000",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#808080",
      "#ffff00",
      "#7c3aed",
      "#b91c1c",
    ]) {
      const dark = deriveDarkBrandTheme(color);
      for (const ratio of readsEverywhere(dark)) {
        expect(ratio, `${color} -> ${dark.primary}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("hovers lighter, where the light scheme hovers darker", () => {
    const dark = deriveDarkBrandTheme("#158462");
    expect(contrastRatio(dark.primaryHover, BRAND_DARK_GROUND)).toBeGreaterThan(
      contrastRatio(dark.primary, BRAND_DARK_GROUND),
    );
    const light = deriveBrandTheme("#158462");
    expect(contrastRatio(light.primaryHover, BRAND_DEFAULT_SURFACE)).toBeGreaterThan(
      contrastRatio(light.primary, BRAND_DEFAULT_SURFACE),
    );
  });

  it("puts ink on the fill, as the dark palette's own primary does", () => {
    expect(deriveDarkBrandTheme("#158462").primaryForeground).toBe(BRAND_INK);
  });

  it("emits the same properties the light theme does", () => {
    expect(Object.keys(brandThemeProperties(deriveDarkBrandTheme("#178f6a")))).toEqual(
      Object.keys(brandThemeProperties(deriveBrandTheme("#178f6a"))),
    );
  });

  /**
   * The constants are copies of globals.css's dark palette, and a copy drifts.
   * If the ground moves and this does not, the derivation goes on clearing a
   * colour against a ground nothing paints — which is the same silent failure
   * the issue describes, one layer down.
   */
  it("checks the grounds globals.css actually paints at depth", async () => {
    const css = await readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/.exec(
      css,
    );
    expect(darkBlock, "globals.css no longer has a dark :root block").not.toBeNull();
    const declared = (name: string) =>
      new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(darkBlock?.[1] ?? "")?.[1];
    expect(declared("background")).toBe(BRAND_DARK_GROUND);
    expect(declared("surface")).toBe(BRAND_DARK_SURFACE);

    const light = /^:root \{([\s\S]*?)\n\}/m.exec(css);
    expect(/--background:\s*(#[0-9a-f]{6})/.exec(light?.[1] ?? "")?.[1]).toBe(
      BRAND_DEFAULT_SURFACE,
    );
  });
});
