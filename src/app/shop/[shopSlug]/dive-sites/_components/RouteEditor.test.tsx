// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RouteEditor } from "./RouteEditor";
import { routeEditorCopy } from "./route-editor-copy";

afterEach(cleanup);

const copy = routeEditorCopy(staffTranslator("en-US"));

const POINTS = [
  { x: 20, y: 30 },
  { x: 45, y: 70 },
  { x: 60, y: 55 },
  { x: 80, y: 40 },
];

function renderEditor(points = POINTS) {
  return render(
    <RouteEditor
      initialPoints={points}
      initialLabel=""
      initialNote=""
      initialZoom={15}
      latitude={25.0106}
      longitude={-80.3764}
      copy={copy}
    />,
  );
}

/**
 * **A waypoint is a dot** (docs/design/pixel-craft.md, class 2; K-413). The
 * route is drawn in a `0 0 100 100` box stretched over the map with
 * `preserveAspectRatio="none"`, which is right for the line, whose points are
 * percentages of the frame, and wrong for a circle: at 698×288 its `r="2.4"`
 * rendered a 33×14px oval. The line stays in the stretched box; each waypoint
 * is a round box of its own at its percentage.
 */
describe("RouteEditor's waypoints", () => {
  it("draws no circle in the stretched box, and every waypoint as a round dot", () => {
    const { container } = renderEditor();
    const stretched = container.querySelector('svg[preserveAspectRatio="none"]');
    expect(stretched?.querySelector("path")).not.toBeNull();
    expect(stretched?.querySelector("circle")).toBeNull();
    const dots = [...container.querySelectorAll("span.rounded-full")] as HTMLElement[];
    expect(dots).toHaveLength(POINTS.length);
    for (const [index, dot] of dots.entries()) {
      // One size for both sides: a `size-*`, never a width and a height apart.
      expect([...dot.classList].filter((token) => /^(size|w|h)-/.test(token))).toEqual([
        "size-3.5",
      ]);
      expect(dot).toHaveStyle({ left: `${POINTS[index].x}%`, top: `${POINTS[index].y}%` });
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(dot).toHaveClass("pointer-events-none");
    }
    // The start, the finish and the ones between, told apart as they were.
    expect(dots[0]).toHaveClass("bg-primary");
    expect(dots[1]).toHaveClass("bg-surface");
    expect(dots[dots.length - 1]).toHaveClass("bg-accent");
  });
});

/**
 * **The route toolbar wraps as two groups, both at the row's end** (class 10;
 * K-268). The status, Zoom's pair, Undo point and Clear route were loose items
 * of one wrapping row with `mr-auto` on the status, whose push only reaches
 * its own line: at 390 the Zoom pair ended at the column's right edge and Undo
 * point wrapped to its left edge below it. And "Clear route", a quiet button,
 * kept its padding, so its label ended 12px inside the column's edge.
 */
describe("RouteEditor's toolbar", () => {
  it("wraps Undo point and Clear route together, to the same end as Zoom", () => {
    renderEditor();
    const undo = screen.getByRole("button", { name: copy.undo });
    const clear = screen.getByRole("button", { name: copy.clear });
    const zoomIn = screen.getByRole("button", { name: copy.zoomIn });
    const pair = undo.parentElement;
    expect(clear.parentElement).toBe(pair);
    expect(pair?.children).toHaveLength(2);
    expect(zoomIn.parentElement).not.toBe(pair);
    const row = pair?.parentElement;
    expect(zoomIn.parentElement?.parentElement).toBe(row);
    // A wrapped line with no status on it ends where the first line does.
    expect(row).toHaveClass("flex-wrap", "justify-end");
    expect(screen.getByText(copy.status[POINTS.length]).parentElement).toBe(row);
  });

  it("sets Clear route's label on the column's edge, its fill 8px past it", () => {
    renderEditor();
    const clear = screen.getByRole("button", { name: copy.clear });
    expect(clear).toHaveClass("-mx-2", "px-2");
    expect(clear).not.toHaveClass("px-3");
  });
});
