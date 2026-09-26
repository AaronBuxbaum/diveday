// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATIONS,
  type StaffDestinationId,
} from "@/lib/staff-destinations";
import { DiveDayIcon, StaffDestinationIcon } from "./StaffDestinationIcon";

afterEach(cleanup);

/** Every `<circle>` an icon draws, as numbers. */
function circles(svg: SVGSVGElement | null) {
  return [...(svg?.querySelectorAll("circle") ?? [])].map((circle) => ({
    cx: Number(circle.getAttribute("cx")),
    cy: Number(circle.getAttribute("cy")),
    r: Number(circle.getAttribute("r")),
  }));
}

/**
 * **Every destination a staffer can reach is drawn.** "Took a call" shipped
 * with no artwork, and the neutral dot the docblock promised for that case
 * could never fire, so the command palette drew a glyph on every row but one
 * (pixel-craft K-275). The map is a full record now, so `tsc` refuses a
 * destination without a picture; this pins the rendered half.
 */
describe("the destination icons", () => {
  const ids = [
    ...new Set<StaffDestinationId>([
      ...STAFF_DESTINATIONS.map((destination) => destination.id),
      ...(Object.keys(STAFF_DESTINATION_LABEL_KEYS) as StaffDestinationId[]),
    ]),
  ];

  it.each(ids)("draws %s", (id) => {
    const { container } = render(<StaffDestinationIcon id={id} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
  });
});

/**
 * **A leading glyph lines up by its ink.** The dive-site catalog door's pin
 * sat in the full 24-unit box, so its ink started 3px inside the column the
 * row's words start on (pixel-craft K-519). `trim` crops the box to the
 * glyph's horizontal ink, stroke included, and keeps the height, so a caller
 * sizing it by height (`h-5 w-auto`) gets a box as wide as the ink.
 */
describe("a trimmed glyph", () => {
  it("crops its box to the ink's width and keeps the full height", () => {
    const { container } = render(<DiveDayIcon name="diveSites" trim className="h-5 w-auto" />);
    // The pin's geometry spans x 5–19; the 1.8 stroke adds 0.9 either side.
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "4.1 0 15.8 24");
  });

  it("follows a heavier stroke out to its edge", () => {
    const { container } = render(<DiveDayIcon name="diveSites" trim strokeWidth={3} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "3.5 0 17 24");
  });

  it("leaves every glyph drawn without it in the shared square", () => {
    const { container } = render(<DiveDayIcon name="diveSites" />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("is refused, at compile time, on a glyph whose ink it does not know", () => {
    // @ts-expect-error — `today` has no recorded ink extent to trim to.
    const { container } = render(<DiveDayIcon name="today" trim />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
  });
});

/**
 * **The empty-state bubbles fill their box.** They reached only y 4.6–18.8 of
 * the 24-unit square, so `EmptyState` drew 7–8px of blank box above the ink
 * and its panel read bottom-heavy: 47px from the top border to the bubbles
 * against 40px from its button to the bottom border (pixel-craft K-70). The
 * glyph now spans its box and sits on its centre, so a caller sizes it by the
 * ink it wants.
 */
describe("the empty glyph", () => {
  it("spans its box's height and sits on its centre", () => {
    const { container } = render(<DiveDayIcon name="empty" />);
    const svg = container.querySelector("svg");
    const half = Number(svg?.getAttribute("stroke-width")) / 2;
    const bubbles = circles(svg);
    const top = Math.min(...bubbles.map(({ cy, r }) => cy - r - half));
    const bottom = Math.max(...bubbles.map(({ cy, r }) => cy + r + half));
    const left = Math.min(...bubbles.map(({ cx, r }) => cx - r - half));
    const right = Math.max(...bubbles.map(({ cx, r }) => cx + r + half));

    expect(bubbles).toHaveLength(3);
    expect(top).toBeLessThanOrEqual(2);
    expect(bottom).toBeGreaterThanOrEqual(22);
    expect(top).toBeGreaterThanOrEqual(1);
    expect(bottom).toBeLessThanOrEqual(23);
    expect(Math.abs((top + bottom) / 2 - 12)).toBeLessThanOrEqual(0.1);
    expect(Math.abs((left + right) / 2 - 12)).toBeLessThanOrEqual(0.1);
  });
});

/**
 * **The row menu's "···" reads as three dots at the 16px it is drawn at.**
 * At `r=1` in the 24-unit box they rendered as 1.3px specks, lighter than the
 * muted ink they are painted in (pixel-craft K-89). A 2-unit radius is a
 * 2.7px dot at `size-4`, and a 3-unit gap keeps 2px of paper between them, so
 * antialiasing cannot run them into a dash.
 */
describe("the more glyph", () => {
  it("draws three even dots big enough to read at size-4", () => {
    const { container } = render(<DiveDayIcon name="more" className="size-4" />);
    const dots = circles(container.querySelector("svg"));

    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.r).toBeGreaterThanOrEqual(1.5);
      expect(dot.cy).toBe(12);
    }
    const [a, b, c] = dots;
    expect(b.cx - a.cx).toBe(c.cx - b.cx);
    expect(b.cx).toBe(12);
    expect(b.cx - a.cx - a.r - b.r).toBeGreaterThanOrEqual(3);
  });
});
