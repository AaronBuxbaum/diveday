// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { BrandStyle } from "./BrandStyle";

const COLOR = DIVEDAY_BRAND_COLOR;
const THEME = deriveBrandTheme(COLOR);

function styleText(ui: React.ReactElement): string {
  const { container } = render(ui);
  return container.querySelector("style[data-brand-style]")?.textContent ?? "";
}

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

  it("never names a token that carries a fact", () => {
    const css = styleText(<BrandStyle brandColor={COLOR} brandDisplayFont="outfit" />);
    const names = [...css.matchAll(/--[a-z-]+(?=:)/g)].map((m) => m[0]);
    expect(names).toEqual([
      "--primary",
      "--primary-hover",
      "--primary-tint",
      "--primary-foreground",
      "--focus-ring",
      "--brand-display",
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
