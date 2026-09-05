import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AA_TEXT_CONTRAST, contrastRatio } from "./brand";

/**
 * **The four washes, read back out of the stylesheet** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 1.
 *
 * The sibling of `night-palette.test.ts`, and a separate file for the reason
 * that one states: its rules are about *signal* washes, where each wash must
 * keep the hue of the signal it stands for. A water wash stands for no signal
 * at all. What it must hold instead is here, and all three are things a
 * plausible-looking hex can break in silence:
 *
 * 1. **Every ink that sits in the first 168px still reads.** The band is
 *    behind the page's own header, so the title (`--foreground`), its meta
 *    line (`--muted`) and any link in it (`--primary`) sit on the crest. In
 *    the light palette that is the binding constraint and it is tight:
 *    `--primary` on the shipped day wash measures 4.72:1, so the four washes
 *    are separated by hue at a readable lightness rather than by depth. In
 *    dark, contrast rises as the wash darkens, so depth is free there.
 * 2. **Never coral** (Budget rule 8). Stated as a measurement rather than a
 *    promise: each wash is nearer in hue to the ground it settles into or to
 *    the lagoon than it is to `--accent`.
 * 3. **The day wash is the one that ships.** Rule 1 says an hour outside the
 *    three named windows renders the day wash "as today", so `--water-day`
 *    carries `--primary-tint`'s exact value. Two hexes that must agree drift
 *    apart eventually; this is what notices.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const WASHES = ["dawn", "day", "dusk", "night"] as const;

function tokens(scheme: "light" | "dark"): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const start =
    scheme === "light"
      ? css.indexOf(":root {")
      : css.indexOf("@media (prefers-color-scheme: dark) {\n  :root {");
  if (start < 0) throw new Error(`expected the ${scheme} :root block in globals.css`);
  const block = css.slice(start, css.indexOf(scheme === "light" ? "\n}" : "\n  }\n}", start));
  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    if (name && value) found[name] = value.trim();
  }
  return found;
}

/** Hue in degrees — the same measurement `night-palette.test.ts` makes. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return Number.NaN;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe.each(["light", "dark"] as const)("the water band's washes (%s)", (scheme) => {
  const palette = tokens(scheme);

  it.each(WASHES)("--water-%s is a drawn hex", (wash) => {
    expect(palette[`water-${wash}`]).toMatch(HEX);
  });

  it.each(WASHES)("every ink in the band's first 168px clears AA on --water-%s", (wash) => {
    const stop = palette[`water-${wash}`] as string;
    for (const ink of ["foreground", "muted", "primary"] as const) {
      const ratio = contrastRatio(palette[ink] as string, stop);
      expect(
        ratio,
        `--${ink} on --water-${wash} (${palette[ink]} on ${stop}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  it.each(WASHES)("--water-%s is water or sand, never coral", (wash) => {
    const stop = hue(palette[`water-${wash}`] as string);
    const toAccent = hueDistance(stop, hue(palette.accent as string));
    const toWater = Math.min(
      hueDistance(stop, hue(palette.primary as string)),
      hueDistance(stop, hue(palette.background as string)),
    );
    expect(toWater, `--water-${wash} sits ${toAccent.toFixed(0)}° from --accent`).toBeLessThan(
      toAccent,
    );
  });

  it("the day wash is --primary-tint, which is what ships at every other hour", () => {
    expect(palette["water-day"]).toBe(palette["primary-tint"]);
  });
});

describe("the band's own rules", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const band = css.slice(css.indexOf(".water-band {"), css.indexOf(".marketing-reveal-pending"));

  it("names a crest token for each of the three washes that are not the default", () => {
    for (const wash of ["dawn", "dusk", "night"] as const) {
      expect(band).toContain(`.water-band[data-water-band="${wash}"]`);
      expect(band).toContain(`--water-crest: var(--water-${wash});`);
    }
  });

  it("spells no colour of its own, so every skin keeps its own water", () => {
    expect(band).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
