// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClosingCtaSkeleton } from "@/app/_components/ClosingCtaSkeleton";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import {
  HUB_CLOSING_ROW_CLASS,
  HUB_HERO_CLASS,
  HUB_LIST_SECTION_CLASS,
  HUB_PREVIEW_BAND_CLASS,
  HUB_PREVIEW_BOX_CLASS,
  HUB_ROW_SUMMARY_LINES,
  SwitchHubBodySkeleton,
} from "./hub";

afterEach(cleanup);

/**
 * **The switching hub's skeleton is the hub, row for row** (K-406).
 *
 * Its rows were 105px bars (a 24px title bar, a 20px summary bar) for rows of
 * a 28px title and 28px summary lines, 111–139px at 1280 and 167–223 at 390;
 * the hero's lede bars were 20px for 32px lines; the closing row had no bar
 * for its two doors; and nothing stood in for the import preview or the
 * close below the list. Each part is now drawn in the hub's own boxes,
 * with a bar per line its words wrap to.
 */
describe("the switching hub's skeleton", () => {
  function sections() {
    const { container } = render(<SwitchHubBodySkeleton />);
    const main = container.querySelector("main");
    return { main, sections: Array.from(main?.children ?? []) };
  }
  const linesOf = (wrapper: Element | undefined) => Array.from(wrapper?.children ?? []);

  it("paints nothing a reader could tap", () => {
    const { main } = sections();
    expect(main).toHaveClass("flex-1", "animate-pulse");
    expect(main?.querySelectorAll("a, button, form, input")).toHaveLength(0);
  });

  it("draws the hero's 20px eyebrow, 40px (48 from sm) title lines and 32px lede lines", () => {
    const [hero] = sections().sections;
    expect(hero.className).toBe(HUB_HERO_CLASS);
    const [eyebrow, title, lede] = Array.from(hero.children);
    expect(eyebrow).toHaveClass("h-5");
    expect(title).toHaveClass("mt-4");
    expect(linesOf(title)).toHaveLength(2);
    for (const line of linesOf(title)) expect(line).toHaveClass("h-10", "sm:h-12");
    expect(lede).toHaveClass("mt-5");
    expect(linesOf(lede)).toHaveLength(3);
    for (const line of linesOf(lede)) expect(line).toHaveClass("h-8");
    expect(linesOf(lede)[2]).toHaveClass("sm:hidden");
  });

  it("draws a row per guide: a 28px title line and a 28px line per summary line", () => {
    const [, list] = sections().sections;
    expect(list.className).toBe(HUB_LIST_SECTION_CLASS);
    const rows = Array.from(list.querySelectorAll("ul > li"));
    expect(rows).toHaveLength(MIGRATION_GUIDES.length + 1);
    for (const row of rows) {
      const [title, summary] = Array.from(row.firstElementChild?.children ?? []);
      expect(title).toHaveClass("h-7");
      expect(summary).toHaveClass("mt-1.5");
      expect(linesOf(summary).length).toBeGreaterThan(0);
      for (const line of linesOf(summary)) expect(line).toHaveClass("h-7");
    }
    // The spreadsheet row's summary: three lines on a phone, one from sm.
    const spreadsheet = linesOf(rows[0].firstElementChild?.children[1]);
    expect(spreadsheet).toHaveLength(3);
    expect(spreadsheet.slice(1).every((line) => line.classList.contains("sm:hidden"))).toBe(true);
  });

  it("closes the list with the not-listed row, whose doors moved to the page's close", () => {
    const [, list] = sections().sections;
    const closing = list.lastElementChild;
    expect(closing?.className).toBe(HUB_CLOSING_ROW_CLASS);
    expect(closing?.children).toHaveLength(1);
    expect(closing?.firstElementChild?.firstElementChild).toHaveClass("h-7");
  });

  it("stands in for the import preview band at the mock's own height", () => {
    const [, , preview] = sections().sections;
    expect(preview.className).toBe(HUB_PREVIEW_BAND_CLASS);
    const box = preview.firstElementChild;
    expect(box?.className).toBe(HUB_PREVIEW_BOX_CLASS);
    const mock = box?.children[2];
    // The preview mock renders 446px tall at 390 and 414 from sm.
    expect(mock).toHaveClass("mt-8", "h-[446px]", "sm:h-[414px]", "rounded-panel", "border");
    // Four notes, then the door's 8px and 48px.
    const notes = box?.children[3];
    expect(notes?.children).toHaveLength(4);
    expect(box?.children[4]).toHaveClass("mt-2", "h-12");
  });

  // The concierge offer is the close's support line on the hub (B15), so
  // the preview band is followed by the closing band and nothing else.
  it("ends with the closing band's own skeleton", () => {
    const all = sections().sections;
    expect(all).toHaveLength(4);
    const real = render(<ClosingCtaSkeleton measure="column" />).container.firstElementChild;
    expect(all[3].className).toBe(real?.className);
    // On the hub's own column, the left edge of every section above it (B15 review).
    expect(all[3].firstElementChild?.className).toBe(real?.firstElementChild?.className);
    expect(all[3].firstElementChild).toHaveClass("max-w-4xl");
  });

  it("knows the summary lines of every row the hub lists", () => {
    expect(Object.keys(HUB_ROW_SUMMARY_LINES).sort()).toEqual(
      ["spreadsheet", ...MIGRATION_GUIDES.map((guide) => guide.slug)].sort(),
    );
  });
});
