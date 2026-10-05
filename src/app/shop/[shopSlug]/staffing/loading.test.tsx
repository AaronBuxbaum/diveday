// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { WEEK_GRID, weekTailRowClass } from "./_components/StaffingWeek";
import StaffingLoading from "./loading";

afterEach(cleanup);

/**
 * **The staffing skeleton has the week's geometry** (docs/design/pixel-craft.md,
 * class 11: nothing shifts when the week arrives). K-274 measured it short at
 * every step: the pager's squares 36px against the loaded 48, the day-header
 * band 32px against 36, a chip bar 32px where a two-line shift chip is 46 (44
 * before K-498 gave every chip its 1px edge), and on a phone grey cards under
 * a rule where the page draws hairline rows under a label. Class 11 is
 * eyes-only for the probe, so the classes are pinned here.
 */
function skeleton() {
  const { container } = render(<StaffingLoading />);
  const grid = container.querySelector<HTMLElement>('[class~="lg:block"]');
  const list = container.querySelector<HTMLElement>('[class~="lg:hidden"]');
  if (!grid || !list) throw new Error("the skeleton should draw a grid and a day list");
  return { container, grid, list };
}

const tokens = (element: Element) => [...element.classList];

describe("the staffing skeleton", () => {
  it("draws the week pager's step squares at the pager's own 48px", () => {
    const { container } = skeleton();
    // The pager's steps are `buttonClass`'s `icon` size: 48px each way.
    expect(buttonClass({ variant: "secondary", size: "icon" }).split(" ")).toEqual(
      expect.arrayContaining(["w-12", "min-h-12"]),
    );
    const squares = [...container.querySelectorAll("*")].filter((element) =>
      tokens(element).some((token) => /^size-/.test(token)),
    );
    expect(squares).toHaveLength(2);
    for (const square of squares) expect(square).toHaveClass("size-12");
  });

  it("draws the grid from the loaded grid's own parts", () => {
    const { grid } = skeleton();
    const [header, ...rows] = [...grid.children];
    expect(header).toHaveClass(...WEEK_GRID.row.split(" "));
    expect(header.firstElementChild).toHaveClass(...WEEK_GRID.personHead.split(" "));
    const heads = [...header.children].slice(1);
    expect(heads).toHaveLength(7);
    for (const head of heads) {
      expect(head).toHaveClass(...WEEK_GRID.dayHead.split(" "));
      // The label's own line, 16px: the band is then 10 + 16 + 10, as loaded.
      expect(head.firstElementChild).toHaveClass("h-4");
    }
    for (const row of rows) expect(row).toHaveClass(...WEEK_GRID.row.split(" "));
    const people = rows.filter((row) => row.children.length === 8);
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.firstElementChild).toHaveClass(...WEEK_GRID.person.split(" "));
      for (const day of [...person.children].slice(1)) {
        expect(day).toHaveClass(...WEEK_GRID.day.split(" "));
        // A shift stand-in is a shift's own box around its two 16px lines,
        // so it follows the shift's padding and edge: 1 + 6 + 32 + 6 + 1 =
        // 46px. A fixed height drifted 2px a row when K-498 added the edge.
        for (const bar of day.children) {
          expect(bar).toHaveClass(...WEEK_GRID.shiftChip.split(" "));
          const lines = [...bar.children];
          expect(lines).toHaveLength(2);
          for (const line of lines) expect(line).toHaveClass("h-4");
        }
      }
    }
  });

  it("draws the phone's day list as hairline rows under a label, never as cards", () => {
    const { list } = skeleton();
    const days = [...list.children];
    expect(days.length).toBeGreaterThan(1);
    for (const day of days) {
      // No rule above a day's label: the loaded list has none, and the first
      // day opens straight under the pager.
      expect(tokens(day).filter((token) => /(?:^|:)border-t$/.test(token))).toEqual([]);
      expect(day).toHaveClass("mt-6", "first:mt-0");
    }
    const rows = [...list.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveClass(...ledgerRowBoxClass.split(" "));
      expect(row).not.toHaveClass("rounded-lg");
      expect(row).not.toHaveClass("bg-surface-sunken");
    }
  });

  it("draws the page's doors on their closing rule alone, as the page does", () => {
    const { container } = skeleton();
    const doors = [...container.querySelectorAll("*")].filter((element) =>
      weekTailRowClass.split(" ").every((token) => element.classList.contains(token)),
    );
    expect(doors).toHaveLength(2);
  });
});
