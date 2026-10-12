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

/**
 * **The period between two arrows, and nothing else** (UX review 2026-10-10,
 * item 32; the 2026-10-07 audit's item 22 had dropped the "Go" button and
 * kept a month list). The arrows are links, so a tap is the change.
 */
describe("the reports month navigator", () => {
  it("is the previous arrow, the month's own heading, then the next arrow", () => {
    expect(NAV_START, "the navigator is where this test looks for it").toBeGreaterThan(-1);
    const previous = NAVIGATOR.indexOf('t("reports.previousMonth")');
    const heading = NAVIGATOR.indexOf("monthLabel(current, locale)");
    const next = NAVIGATOR.indexOf('t("reports.nextMonth")');
    expect(previous).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(previous);
    expect(next).toBeGreaterThan(heading);
  });

  it("carries no list, no box and no submit", () => {
    expect(NAVIGATOR).not.toContain("<select");
    expect(NAVIGATOR).not.toContain("MonthJump");
    expect(NAVIGATOR).not.toContain('type="submit"');
    expect(PAGE).not.toContain("MonthJump");
  });
});
