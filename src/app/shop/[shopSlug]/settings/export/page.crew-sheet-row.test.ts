import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const FORM_START = SOURCE.indexOf("/crew-sheet`}");
const CREW_SHEET = SOURCE.slice(FORM_START, SOURCE.indexOf("</form>", FORM_START));

/**
 * **The crew sheet's month stands level with its download button.** The month
 * select sits in a `Field` on one `items-end` line with an `md` button; it was
 * the stacked field's 44px, so the button stood 4px above its top edge. The
 * probe groups a `Field`'s control with its caption, so it never compared the
 * two; this was found by reading the code (review of 2026-09-25).
 */
describe("the crew sheet row", () => {
  it("draws the month select at md", () => {
    expect(FORM_START, "the crew-sheet form is where this test looks").toBeGreaterThan(-1);
    expect(CREW_SHEET).toMatch(/<select\s+name="month"[^>]*className=\{controlClassFor\("md"\)\}/);
  });
});
