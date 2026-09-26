// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { segmentedTrackClass } from "@/components/ui/segmented";
import { CREW_COLUMN, METER_COLUMN } from "./_components/DepartureLedger";
import { figureCellClass } from "./_components/MonthFigures";
import ReportsLoading from "./loading";

afterEach(cleanup);

/** The element whose class list holds every token of `classes`. */
function withClasses(root: ParentNode, classes: string): Element[] {
  const tokens = classes.split(/\s+/).filter(Boolean);
  return [...root.querySelectorAll("*")].filter((element) =>
    tokens.every((token) => element.classList.contains(token)),
  );
}

/**
 * **The Reports skeleton is the page it stands in for** (K-391, pixel-craft
 * class 11). It had no stand-in for the month/year tabs, so everything below
 * dropped 78px when the page landed (a 54px track and its `mb-6`); it drew the
 * month stepper's controls at 44px after they became `md`'s 48px; and it drew
 * one-line 48px departure rows where the loaded rows carry two lines, 65px
 * from `sm` and 69px on a phone.
 */
describe("the Reports skeleton", () => {
  it("draws the range tabs' track, one 44px option deep, before the month stepper", () => {
    const { container } = render(<ReportsLoading />);
    const [track] = withClasses(container, segmentedTrackClass);
    expect(track).toBeDefined();
    // 1px border + 4px padding + a 44px option + 4px + 1px: the loaded 54px.
    expect(track).toHaveClass("mb-6");
    expect(track.firstElementChild).toHaveClass("h-11");
    const stepper = container.querySelector(".size-12");
    if (!stepper) throw new Error("no 48px stepper square");
    expect(track.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the stepper's row at md: 48px squares, field and Go, beside a 28px heading line", () => {
    const { container } = render(<ReportsLoading />);
    expect(container.querySelectorAll(".size-12")).toHaveLength(2);
    expect(container.querySelector(".h-11.w-11")).toBeNull();
    expect(withClasses(container, "h-12 w-44")).toHaveLength(1);
    expect(withClasses(container, "h-12 w-14")).toHaveLength(1);
    // `SECTION_TITLE_CLASS` is text-lg, a 28px line; on a phone the heading
    // takes a line of its own over the stepper, so its height is the drop.
    expect(withClasses(container, "h-7 w-40")).toHaveLength(1);
  });

  it("draws each departure row as the loaded row's two lines, never a one-line min-h-12", () => {
    const { container } = render(<ReportsLoading />);
    const rows = [...container.querySelectorAll("li, div")].filter((element) =>
      element.className.includes("border-t border-border last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveClass("min-h-12");
      expect(row).toHaveClass("min-h-13", "py-2");
      // The title's 24px line, then the facts' 20px line 8px (4px from `sm`) down.
      const lines = row.querySelectorAll(":scope > div > div");
      expect(lines[0]).toHaveClass("h-6");
      expect(lines[1]).toHaveClass("mt-2", "sm:mt-1", "h-5");
    }
  });

  /**
   * From `lg` the loaded facts stand in fixed columns — seats, crew, waivers —
   * sized for the longest real fact (K-285). Drawn at the old `lg:w-52` and
   * `lg:w-20`, the bars ended 48px and 112px left of the loaded columns.
   */
  it("draws the facts' bars in the ledger's own seats, crew and waivers columns", () => {
    const { container } = render(<ReportsLoading />);
    const facts = container.querySelectorAll(".mt-2.h-5");
    expect(facts.length).toBeGreaterThan(0);
    for (const line of facts) {
      const widths = [...line.children].map((bar) =>
        [...bar.classList].filter((token) => token.startsWith("lg:w-")).join(" "),
      );
      expect(widths).toEqual([METER_COLUMN, CREW_COLUMN, METER_COLUMN]);
    }
  });

  it("stands the figures' own cells in for the figures", () => {
    const { container } = render(<ReportsLoading />);
    const band = container.querySelector(".-mx-2.grid");
    const cells = [...(band?.children ?? [])];
    expect(cells).toHaveLength(5);
    cells.forEach((cell, index) => {
      for (const token of figureCellClass(index).split(" ")) expect(cell).toHaveClass(token);
    });
  });
});
