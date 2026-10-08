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
const BOX_START = JUMP.indexOf("<DateField");
const MONTH_BOX = JUMP.slice(BOX_START, JUMP.indexOf("/>", BOX_START));

/**
 * **Arrows and one month box, applied on change** (UX audit 2026-10-07, item
 * 22). The row was arrows, a month box and a "Go" button: three controls for
 * one choice. The arrows are `icon`, 48px squares level with the 48px box,
 * and the box's width sits on a wrapper the input fills (`controlClass`
 * carries `w-full`).
 */
describe("the reports month navigator", () => {
  it("is two arrows and the month box, with no Go button", () => {
    expect(NAV_START, "the navigator is where this test looks for it").toBeGreaterThan(-1);
    expect(NAVIGATOR).toContain("<MonthJump");
    expect(NAVIGATOR).not.toContain('type="submit"');
    expect(JUMP).not.toContain('type="submit"');
  });

  it("applies the month the moment one is picked", () => {
    expect(BOX_START, "the month box is a DateField").toBeGreaterThan(-1);
    expect(MONTH_BOX).toContain('type="month"');
    expect(MONTH_BOX).toContain("requestSubmit()");
  });

  it("sets the month box's width on a wrapper, not beside the control's own w-full", () => {
    expect(MONTH_BOX).toContain('wrapperClassName="w-44"');
    expect(MONTH_BOX, "no width utility on the input itself").not.toMatch(/\sclassName=/);
  });
});
