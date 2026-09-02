// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BRAND_DARK_GROUND,
  contrastRatio,
  DIVEDAY_BRAND_COLOR,
  deriveBrandTheme,
  deriveDarkBrandTheme,
} from "@/lib/brand";
import { BrandStyle } from "./BrandStyle";

const COLOR = DIVEDAY_BRAND_COLOR;
const THEME = deriveBrandTheme(COLOR);
const DARK_THEME = deriveDarkBrandTheme(COLOR);

function styleText(ui: React.ReactElement): string {
  const { container } = render(ui);
  return container.querySelector("style[data-brand-style]")?.textContent ?? "";
}

/** The light `:root` block and the dark one, split at the media query. */
function blocks(css: string): { light: string; dark: string } {
  const at = css.indexOf("@media");
  return at === -1 ? { light: css, dark: "" } : { light: css.slice(0, at), dark: css.slice(at) };
}

const tokenNames = (css: string) => [...css.matchAll(/--[a-z-]+(?=:)/g)].map((m) => m[0]);

/**
 * Harbor's one hard line (ADR 20260901-diveday-reimagined, decision 2): the
 * shop's colour reaches the action tokens and nothing else. A brand that could
 * re-point `--danger` would be a brand that could recolour a refused waiver.
 */
describe("BrandStyle", () => {
  it("renders nothing for a shop that has set no brand", () => {
    const { container } = render(<BrandStyle brandColor={null} brandDisplayFont={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("re-points the four action tokens and the focus ring, derived from the colour", () => {
    const css = styleText(<BrandStyle brandColor={COLOR} brandDisplayFont={null} />);
    expect(css).toContain(`--primary:${THEME.primary}`);
    expect(css).toContain(`--primary-hover:${THEME.primaryHover}`);
    expect(css).toContain(`--primary-tint:${THEME.primaryTint}`);
    expect(css).toContain(`--primary-foreground:${THEME.primaryForeground}`);
    expect(css).toContain(`--focus-ring:${THEME.primary}`);
  });

  it("never names a token that carries a fact, in either scheme", () => {
    const css = styleText(<BrandStyle brandColor={COLOR} brandDisplayFont="outfit" />);
    const { light, dark } = blocks(css);
    expect(tokenNames(light)).toEqual([
      "--primary",
      "--primary-hover",
      "--primary-tint",
      "--primary-foreground",
      "--focus-ring",
      "--brand-display",
    ]);
    // The dark block re-points the colour tokens only — a face is a face in
    // both schemes, so `--brand-display` is not repeated.
    expect(tokenNames(dark)).toEqual([
      "--primary",
      "--primary-hover",
      "--primary-tint",
      "--primary-foreground",
      "--focus-ring",
    ]);
    for (const forbidden of [
      "--success",
      "--warning",
      "--danger",
      "--foreground",
      "--background",
    ]) {
      expect(css).not.toContain(`${forbidden}:`);
    }
  });

  it("loads the chosen face from the one allowed host, and only when one is chosen", () => {
    const withFace = render(<BrandStyle brandColor={null} brandDisplayFont="lora" />);
    const link = document.querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute("href")).toMatch(/^https:\/\/fonts\.googleapis\.com\//);
    expect(styleText(<BrandStyle brandColor={null} brandDisplayFont="lora" />)).toContain(
      "--brand-display:'Lora'",
    );
    withFace.unmount();
  });
});

describe("BrandStyle, inheriting a host page", () => {
  it("makes the host's face the body and heading face, and skips the Google link", () => {
    const { container } = render(
      <BrandStyle brandColor={null} brandDisplayFont="lora" hostFont="Manrope, sans-serif" />,
    );
    const css = container.querySelector("style[data-brand-style]")?.textContent ?? "";
    expect(css).toContain("--font-sans:Manrope, sans-serif");
    expect(css).toContain("--brand-display:Manrope, sans-serif");
    expect(css).not.toContain("Lora");
  });
});

/**
 * Issue #1265. This block emits after globals.css and a media query adds no
 * specificity, so a single `:root` block wins in **both** schemes — which is
 * how every branded storefront came to wear its light-mode colour at depth,
 * around 3:1. The dark half is a second block, not a second picker.
 */
describe("BrandStyle, at depth", () => {
  it("emits a dark-scheme block with the dark derivation of the same colour", () => {
    const { dark } = blocks(styleText(<BrandStyle brandColor={COLOR} brandDisplayFont={null} />));
    expect(dark).toContain("@media(prefers-color-scheme:dark)");
    expect(dark).toContain(`--primary:${DARK_THEME.primary}`);
    expect(dark).toContain(`--primary-hover:${DARK_THEME.primaryHover}`);
    expect(dark).toContain(`--primary-tint:${DARK_THEME.primaryTint}`);
    expect(dark).toContain(`--primary-foreground:${DARK_THEME.primaryForeground}`);
    expect(dark).toContain(`--focus-ring:${DARK_THEME.primary}`);
  });

  it("emits a colour that reads on the dark ground, where the light one does not", () => {
    expect(contrastRatio(THEME.primary, BRAND_DARK_GROUND)).toBeLessThan(4.5);
    expect(contrastRatio(DARK_THEME.primary, BRAND_DARK_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it("orders the dark block after the light one, since neither out-specifies the other", () => {
    const css = styleText(<BrandStyle brandColor={COLOR} brandDisplayFont={null} />);
    expect(css.indexOf(":root{")).toBeLessThan(css.indexOf("@media"));
  });

  it("emits no dark block for a shop that set only a face", () => {
    const css = styleText(<BrandStyle brandColor={null} brandDisplayFont="lora" />);
    expect(css).not.toContain("@media");
  });
});
