import { describe, expect, it } from "vitest";
import {
  SECTION_TAB_LIST_CLASS,
  sectionTabClass,
  WRAPPING_SECTION_TAB_LIST_CLASS,
} from "./SectionTabs";

/**
 * **No scroll bar on a tab strip** (Aaron, 2026-10-03: every tab component
 * showed one). The list used to be `overflow-x-auto` while each tab pulled its
 * underline 1px over the rule with `-mb-px`; an `overflow-x` that is not
 * `visible` makes `overflow-y` scroll too, so that 1px became a vertical
 * scroll bar on every strip. The tabs now fit by sharing the row, so nothing
 * here may clip or scroll.
 */
describe("section tabs", () => {
  it("keeps shared labels whole while departure wrapping is explicit", () => {
    expect(SECTION_TAB_LIST_CLASS).toContain("minmax(min-content,1fr)");
    expect(SECTION_TAB_LIST_CLASS).not.toContain("minmax(0,1fr)");
    expect(WRAPPING_SECTION_TAB_LIST_CLASS).toContain("repeat(auto-fit");
    expect(WRAPPING_SECTION_TAB_LIST_CLASS).toContain("min(100%,5rem)");
    for (const active of [false, true]) {
      expect(sectionTabClass(active)).toMatch(/\bwhitespace-nowrap\b/);
      expect(sectionTabClass(active)).not.toMatch(/\bwhitespace-normal\b/);
      expect(sectionTabClass(active, { wrap: true })).toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it("never makes the strip a scroll container", () => {
    const classes = [
      SECTION_TAB_LIST_CLASS,
      WRAPPING_SECTION_TAB_LIST_CLASS,
      sectionTabClass(true),
      sectionTabClass(false),
      sectionTabClass(true, { wrap: true }),
      sectionTabClass(false, { wrap: true }),
    ].join(" ");
    expect(classes).not.toMatch(/\boverflow-/);
  });
});
