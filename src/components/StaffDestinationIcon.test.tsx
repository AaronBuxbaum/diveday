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
