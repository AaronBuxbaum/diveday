import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./brand";

/**
 * **Boat mode, both palettes** — ADR 20261001-logbook, decision 6, as amended
 * by H-97. By day the roll call is light (white ground, navy ink, navy actions
 * labelled in yellow), because sun on a screen washes a dark ground out; in
 * the device's dark scheme it is Night Dive navy. Reads both `.boat-mode`
 * blocks out of `globals.css` and holds every pair the roll call reads to
 * 6:1, the margin the deck asks for over AA's 4.5.
 */

const DECK_CONTRAST = 6;
const HEX = /^#[0-9a-f]{6}$/i;

const css = readFileSync("src/app/globals.css", "utf8");

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`expected ${JSON.stringify(marker)} in globals.css`);
  return css.slice(start, css.indexOf("}", start));
}

const day = tokensIn(blockAfter(":root.boat-mode,\n.boat-mode {"));
const night = tokensIn(
  blockAfter("@media (prefers-color-scheme: dark) {\n  :root.boat-mode,\n  .boat-mode {"),
);

/** A translucent fill as it lands, `alpha` of `ink` over `ground`. */
function over(ink: string, ground: string, alpha: number): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(ink, i) * alpha + channel(ground, i) * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe.each([
  ["by day", day],
  ["at night", night],
])("the Boat palette %s", (_name, tokens) => {
  const token = (name: string): string => {
    const value = tokens[name];
    if (!value || !HEX.test(value)) throw new Error(`no hex --${name}`);
    return value;
  };

  it("keeps every ink at 6:1 on every ground the roll call has", () => {
    for (const ink of ["foreground", "muted", "primary", "success", "warning", "danger", "info"]) {
      for (const ground of ["background", "surface", "surface-sunken"]) {
        expect(
          contrastRatio(token(ink), token(ground)),
          `--${ink} on --${ground}`,
        ).toBeGreaterThanOrEqual(DECK_CONTRAST);
      }
    }
  });

  it("labels an action at 6:1 on its own fill", () => {
    expect(contrastRatio(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(
      DECK_CONTRAST,
    );
    expect(contrastRatio(token("accent-foreground"), token("accent"))).toBeGreaterThanOrEqual(
      DECK_CONTRAST,
    );
  });

  it("keeps a status readable on its own wash", () => {
    for (const [wash, signal] of [
      ["primary-tint", "primary"],
      ["success-tint", "success"],
      ["warning-tint", "warning"],
      ["danger-tint", "danger"],
    ] as const) {
      expect(
        contrastRatio(token(signal), token(wash)),
        `--${signal} on --${wash}`,
      ).toBeGreaterThanOrEqual(DECK_CONTRAST);
    }
  });

  it("keeps a status readable on a 15% fill of itself, the roll-call rows' tint", () => {
    // `check-tinted-ink` exempts the roll-call files on this promise.
    for (const signal of ["success", "warning", "danger"]) {
      const fill = over(token(signal), token("surface-sunken"), 0.15);
      expect(contrastRatio(token(signal), fill), `--${signal} on its 15% fill`).toBeGreaterThan(
        4.5,
      );
    }
  });
});

describe("the two Boat palettes", () => {
  it("are light by day and dark at night", () => {
    expect(contrastRatio(day.background ?? "", "#ffffff")).toBeLessThan(1.1);
    expect(contrastRatio(night.background ?? "", "#000000")).toBeLessThan(1.5);
  });

  it("share one identity: navy and marine safety yellow", () => {
    expect(day.primary).toBe(night.background);
    expect(day["primary-foreground"]).toBe(night.primary);
  });
});
