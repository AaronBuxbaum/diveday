import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read rather than a render: the month navigator is inline in a
 * Server Component page that needs a database to render at all. So this pins
 * the source that decides the geometry; nothing here measures it.
 */
const PAGE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const NAV_START = PAGE.indexOf('<nav aria-label={t("reports.chooseMonth")}');
const NAVIGATOR = PAGE.slice(NAV_START, PAGE.indexOf("</nav>", NAV_START));
const JUMP = readFileSync(join(import.meta.dirname, "_components", "MonthJump.tsx"), "utf8");

/**
 * **Arrows and one month list, applied on change** (UX audit 2026-10-07, item
 * 22). The row was arrows, a month box and a "Go" button: three controls for
 * one choice. The arrows are `icon`, 48px squares level with the 48px select.
 *
 * **The list is the shop's months in the shop's words** (#1983): a native
 * `<input type="month">` drew the month in the browser's language in a fixed
 * box too narrow for "September 2026", let alone "septiembre de 2026". What
 * the select renders is pinned in `_components/MonthJump.test.tsx`; this pins
 * that the page hands it the shop-language labels from the clamped floor.
 */
describe("the reports month navigator", () => {
  it("is two arrows and the month list, with no Go button", () => {
    expect(NAV_START, "the navigator is where this test looks for it").toBeGreaterThan(-1);
    expect(NAVIGATOR).toContain("<MonthJump");
    expect(NAVIGATOR).not.toContain('type="submit"');
    expect(JUMP).not.toContain('type="submit"');
  });

  it("lists months from the floor the page clamps to, labelled in the shop's language", () => {
    expect(NAVIGATOR).toContain("monthsNewestFirst(");
    expect(NAVIGATOR).toMatch(/monthsNewestFirst\(\s*floorMonth,/);
    expect(NAVIGATOR).toContain("monthLabel(month, locale)");
  });

  it("is a select, never the browser's own month box", () => {
    expect(JUMP).toContain("<select");
    expect(JUMP).not.toContain("<DateField");
    expect(JUMP, "no month-typed control (the comment may name the old one)").not.toMatch(
      /^\s+type="month"/m,
    );
    expect(JUMP).toContain("requestSubmit()");
  });
});
