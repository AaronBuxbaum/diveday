import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AA_TEXT_CONTRAST, BRAND_DARK_GROUND, BRAND_DARK_SURFACE, contrastRatio } from "./brand";

/**
 * **The night palette, drawn** — ADR 20260901-diveday-reimagined, slice 13j.
 *
 * Reads the dark `:root` block out of `globals.css` and holds two things a
 * restyle must not lose. Every ink that sits on a dark surface still clears AA
 * there — the a11y spec scans the dark scheme on one page, and this is the
 * palette-level rule behind it. And every wash is a drawn hue of its own
 * signal, never a `color-mix` — a 10% mix of a signal over the dark shell goes
 * grey (the danger wash mixed to `#252a34`, with no red in it), which is the
 * same failure Reef's day washes were drawn to escape.
 */

const HEX = /^#[0-9a-f]{6}$/i;

function darkTokens(): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const start = css.indexOf("@media (prefers-color-scheme: dark) {\n  :root {");
  if (start < 0) throw new Error("expected the dark :root block in globals.css");
  const block = css.slice(start, css.indexOf("\n  }\n}", start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

/** Hue in degrees, for "is this wash still its own colour". */
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
  return (((h * 60) % 360) + 360) % 360;
}

function hueDistance(a: string, b: string): number {
  const diff = Math.abs(hue(a) - hue(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const tokens = darkTokens();
const token = (name: string): string => {
  const value = tokens[name];
  if (!value) throw new Error(`no dark --${name}`);
  return value;
};

describe("the night palette", () => {
  it("is the ground the brand derivation was pinned to", () => {
    expect(token("background")).toBe(BRAND_DARK_GROUND);
    expect(token("surface")).toBe(BRAND_DARK_SURFACE);
  });

  it("draws every wash as a hue of its own, never a mix", () => {
    for (const [wash, signal] of [
      ["primary-tint", "primary"],
      ["success-tint", "success"],
      ["warning-tint", "warning"],
      ["danger-tint", "danger"],
      ["accent-tint", "accent"],
    ] as const) {
      expect(token(wash), wash).toMatch(HEX);
      expect(hueDistance(token(wash), token(signal)), `${wash} keeps ${signal}'s hue`).toBeLessThan(
        30,
      );
    }
  });

  it("keeps every ink AA on every surface it sits on", () => {
    const surfaces = ["background", "surface", "surface-sunken"].map(token);
    const inks = ["foreground", "muted", "primary", "primary-hover", "accent", "accent-deep"];
    const signals = ["success", "warning", "danger", "info"];
    for (const ink of [...inks, ...signals]) {
      for (const surface of surfaces) {
        expect(contrastRatio(token(ink), surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(
          AA_TEXT_CONTRAST,
        );
      }
    }
    expect(contrastRatio(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
  });

  it("keeps each signal, and the reading inks, AA on that signal's wash", () => {
    for (const [wash, ink] of [
      ["primary-tint", "primary"],
      ["success-tint", "success"],
      ["warning-tint", "warning"],
      ["danger-tint", "danger"],
      ["accent-tint", "accent-deep"],
    ] as const) {
      for (const over of [ink, "foreground", "muted"]) {
        expect(
          contrastRatio(token(over), token(wash)),
          `${over} on ${wash}`,
        ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      }
    }
  });

  it("keeps the control edge visible against the shell (WCAG 1.4.11)", () => {
    expect(contrastRatio(token("border-strong"), token("surface"))).toBeGreaterThanOrEqual(3);
  });
});
