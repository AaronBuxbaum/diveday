// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * How far the shared `focus-ring` reaches outside its element: the outline's
 * width plus its offset, read from the utility in `globals.css`.
 */
function ringReach() {
  const css = readFileSync(path.join(import.meta.dirname, "../app/globals.css"), "utf8");
  const utility = css.match(/@utility focus-ring \{([^}]*)\}/)?.[1] ?? "";
  const width = utility.match(/outline:\s*(\d+)px/)?.[1];
  const offset = utility.match(/outline-offset:\s*(-?\d+)px/)?.[1];
  if (width === undefined || offset === undefined) throw new Error("no focus-ring utility");
  return Number(width) + Number(offset);
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

  /**
   * **A focused star's ring stays under the legend.** The hang pulls each
   * target 4px up over the legend (`-mt-1`), and while the ring sat on the
   * 44px target it reached 5px further, 9px above the legend's bottom, through
   * the letters of "Your rating". On the star's own box it is 8px inside the
   * target: its top arm is back 1px above the legend's bottom, under the
   * descenders, where it sat before the hang, and it stands 5px outside the
   * column rather than 13.
   */
  it("rings the star's own box, not the 44px target, so the ring clears the legend", () => {
    const { container } = render(<StarRatingInput legend="Your rating" optionLabels={LABELS} />);
    const row = container.querySelector("fieldset > div");
    const target = container.querySelector("label");
    const glyph = container.querySelector("label svg");
    const ringed = container.querySelectorAll("label [class*='focus-visible:focus-ring']");

    expect(ringed).toHaveLength(5);
    const box = ringed[0];
    expect(box).not.toHaveClass("size-11");
    expect(box).toContainElement(glyph as SVGElement | null);
    expect(spacing(box.getAttribute("class"), "size")).toBe(
      spacing(glyph?.getAttribute("class"), "size"),
    );

    const air =
      (spacing(target?.className, "size") - spacing(box.getAttribute("class"), "size")) / 2;
    const ringTop = air - spacing(row?.className, "-mt") - ringReach();
    expect(ringTop).toBeGreaterThanOrEqual(-1);
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
