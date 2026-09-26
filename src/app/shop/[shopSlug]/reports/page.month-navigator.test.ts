import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read rather than a render: the month navigator is inline in a
 * Server Component page that needs a database to render at all. So this pins
 * the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const NAV_START = SOURCE.indexOf('<nav aria-label={t("reports.chooseMonth")}');
const NAVIGATOR = SOURCE.slice(NAV_START, SOURCE.indexOf("</nav>", NAV_START));
const BOX_START = NAVIGATOR.indexOf("<DateField");
const MONTH_BOX = NAVIGATOR.slice(BOX_START, NAVIGATOR.indexOf("/>", BOX_START));

/**
 * **One size across the month navigator, on one line at 390px.** Its arrows
 * are `icon`, 48px squares that sit level with `md`; between them the month
 * box was the stacked field's 44px and "Go" was `sm`, 44px with a 14px label
 * (the pixel probe's `mismatched-controls` cluster on `reports` and
 * `reports-figures`, 2026-09-25). The row is `md`.
 *
 * An `md` "Go" is wider, and the probe's 390px record left 2.4px beside the
 * next-month arrow. The box carried `w-40` beside the `w-full` in
 * `controlClassFor`, and the box drew at its intrinsic 191px; the width now
 * sits on a wrapper the input fills.
 *
 * The box is a `DateField` (K-54), so it wears the house calendar glyph
 * rather than the platform's; `size="md"` and `wrapperClassName` are that
 * component's spellings of the same two decisions.
 */
describe("the reports month navigator", () => {
  it("draws the month box at md, and Go without sm", () => {
    expect(NAV_START, "the navigator is where this test looks for it").toBeGreaterThan(-1);
    expect(BOX_START, "the month box is a DateField").toBeGreaterThan(-1);
    expect(MONTH_BOX).toContain('type="month"');
    expect(MONTH_BOX).toContain('size="md"');
    expect(NAVIGATOR).not.toContain('size: "sm"');
  });

  it("sets the month box's width on a wrapper, not beside the control's own w-full", () => {
    expect(MONTH_BOX, "no width utility on the input itself").not.toMatch(/className=/);
    expect(MONTH_BOX).toContain('wrapperClassName="w-44"');
  });
});
