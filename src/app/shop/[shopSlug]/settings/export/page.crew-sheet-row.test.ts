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

/** Each `<SectionCard>` opening tag's `padding`, `md` where it names none (the default). */
function cardInsets(source: string): string[] {
  return source
    .split("<SectionCard")
    .slice(1)
    .map((tag) => /^[^>]*?\bpadding="(\w+)"/.exec(tag)?.[1] ?? "md");
}

/**
 * **One inset down the page's column.** The crew sheet was the one card at the
 * default `md` inset among the bundle's `p-5 sm:p-6` summary and five `lg`
 * Backups cards, so its heading started 4px left of every other heading on
 * the page — 449 against 453 at 1280, 33 against 37 at 390, the probe's two
 * `ragged-edges` flags on settings-export (K-52, SETTINGS-2-17).
 */
describe("the export page's cards", () => {
  it("sit at the lg inset, or pad their own parts at it", () => {
    const backups = readFileSync(
      join(import.meta.dirname, "_components", "BackupsSection.tsx"),
      "utf8",
    );
    const insets = [...cardInsets(SOURCE), ...cardInsets(backups)];
    expect(insets.length, "every SectionCard on the page is counted").toBeGreaterThanOrEqual(7);
    for (const inset of insets) expect(["lg", "none"]).toContain(inset);
  });
});
