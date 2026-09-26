// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WEEK_DAY_GRID_CLASS, WEEK_ROW_BOX_CLASS } from "./_components/week-geometry";
import ScheduleBoardLoading from "./loading";

afterEach(cleanup);

/**
 * **The board's skeleton draws the board** (docs/design/pixel-craft.md, class
 * 11: 0px of shift on load). Since #1923 the board is one list of days at
 * every width, and this skeleton still drew the two compositions it replaced:
 * a seven-column grid from `xl` with 40px pager squares, and a stream of
 * card-shaped days below it with no pager at all.
 */
describe("the schedule board's loading skeleton (K-466)", () => {
  const classes = (container: HTMLElement) =>
    [...container.querySelectorAll("*")].flatMap((element) => [...element.classList]);

  it("draws no seven-column grid, and nothing only one width sees", () => {
    const { container } = render(<ScheduleBoardLoading />);
    expect(classes(container).filter((name) => /grid-cols-7|repeat\(7/.test(name))).toEqual([]);
    expect(classes(container).filter((name) => /^(lg|xl):(hidden|block)$/.test(name))).toEqual([]);
  });

  it("draws the week pager's two 48px steps at every width", () => {
    // `WeekPager` steps are `icon` buttons: 48px squares.
    const { container } = render(<ScheduleBoardLoading />);
    const steps = container.querySelectorAll(".size-12");
    expect(steps).toHaveLength(2);
    for (const step of steps) expect(step.closest(".hidden")).toBeNull();
    expect(container.querySelector(".size-10")).toBeNull();
  });

  it("stands a week of days on the board's own rail, its departures in the board's row box", () => {
    const { container } = render(<ScheduleBoardLoading />);
    const all = [...container.querySelectorAll("*")];
    expect(all.filter((element) => element.className === WEEK_DAY_GRID_CLASS)).toHaveLength(7);
    expect(
      all.filter((element) => element.className === WEEK_ROW_BOX_CLASS).length,
    ).toBeGreaterThan(0);
  });
});
