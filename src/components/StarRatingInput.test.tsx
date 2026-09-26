// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { STAR_INK_VIEWBOX, STAR_PATH } from "./StarRating";
import { StarRatingInput } from "./StarRatingInput";

afterEach(cleanup);

const LABELS = { 1: "1 star", 2: "2 stars", 3: "3 stars", 4: "4 stars", 5: "5 stars" };

/** A Tailwind spacing class's length in px: `size-11` is 44, `-mx-2` is 8. */
function spacing(className: string | null | undefined, prefix: string) {
  const match = (className ?? "")
    .split(/\s+/)
    .map((token) => token.match(new RegExp(`^${prefix}-(\\d+(?:\\.\\d+)?)$`)))
    .find(Boolean);
  if (!match) throw new Error(`no ${prefix}-* in "${className}"`);
  return Number(match[1]) * 4;
}

/** The star path's ink box, read from its own coordinates. */
function starInk() {
  const numbers = (STAR_PATH.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/**
 * **The stars start on the form's edge.** Each star is a 44px target
 * (design/principles.md §2) holding a glyph about 26px wide, so the row's
 * first star inked 9px inside the column its legend and the comment box start
 * on, and the targets' empty bottom left 26px under the stars where the form
 * keeps 12px between rows (pixel-craft K-478). The targets hang instead, the
 * way `InfoHint`'s do: the row is pulled out by exactly the air a target keeps
 * around its star, so every target stays 44px and the ink lands on the edge.
 */
describe("the star row", () => {
  it("hangs its targets by the air around each star, so the first star's ink is on the edge", () => {
    const { container } = render(<StarRatingInput legend="Your rating" optionLabels={LABELS} />);
    const row = container.querySelector("fieldset > div");
    const target = container.querySelector("label");
    const glyph = container.querySelector("label svg");

    const air =
      (spacing(target?.className, "size") - spacing(glyph?.getAttribute("class"), "size")) / 2;
    expect(spacing(row?.className, "-mx")).toBe(air);
    expect(spacing(target?.className, "size")).toBe(44);
  });

  it("draws each star in a box exactly as wide as its ink, centred on it", () => {
    const { container } = render(<StarRatingInput legend="Your rating" optionLabels={LABELS} />);
    const ink = starInk();
    const [x, y, width, height] = STAR_INK_VIEWBOX.split(" ").map(Number);

    expect(x).toBeCloseTo(ink.left, 5);
    expect(width).toBeCloseTo(ink.right - ink.left, 5);
    expect(y + height / 2).toBeCloseTo((ink.top + ink.bottom) / 2, 2);
    expect(height).toBeGreaterThanOrEqual(ink.bottom - ink.top);
    for (const glyph of container.querySelectorAll("label svg")) {
      expect(glyph).toHaveAttribute("viewBox", STAR_INK_VIEWBOX);
    }
  });

  it("draws the stars, never types them, and keeps five named radios", () => {
    const { container } = render(<StarRatingInput legend="Your rating" optionLabels={LABELS} />);

    expect(container.querySelectorAll("label svg")).toHaveLength(5);
    expect(container.textContent).not.toContain("★");
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeInTheDocument();
  });
});
