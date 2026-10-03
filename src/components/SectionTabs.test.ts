import { describe, expect, it } from "vitest";
import { SECTION_TAB_LIST_CLASS, sectionTabClass } from "./SectionTabs";

/**
 * **No scroll bar on a tab strip** (Aaron, 2026-10-03: every tab component
 * showed one). The list used to be `overflow-x-auto` while each tab pulled its
 * underline 1px over the rule with `-mb-px`; an `overflow-x` that is not
 * `visible` makes `overflow-y` scroll too, so that 1px became a vertical
 * scroll bar on every strip. The tabs now fit by sharing the row, so nothing
 * here may clip or scroll.
 */
describe("section tabs", () => {
  it("never makes the strip a scroll container", () => {
    const classes = [SECTION_TAB_LIST_CLASS, sectionTabClass(true), sectionTabClass(false)].join(
      " ",
    );
    expect(classes).not.toMatch(/\boverflow-/);
  });
});
