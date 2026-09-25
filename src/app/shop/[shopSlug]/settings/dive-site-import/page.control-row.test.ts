import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const FORM = SOURCE.slice(SOURCE.indexOf("<form"), SOURCE.indexOf("</form>"));

/**
 * **The file box stands level with "Import dive sites", under its own
 * caption.** The box was the stacked field's 44px and the submit the card
 * body's `md` 48px; bottom-aligned (`items-end`), the button stood 4px above
 * the box's top edge (`settings-dive-site-import`, 2026-09-25). The box takes
 * md's 48px, and its padding grows with it, so the native picker, which lays
 * its button at the top of the content box instead of centring it, still sits
 * centred.
 *
 * The caption was a hand-built `<label>` wrapping caption and box, which the
 * probe measured as one tall block of text beside the button
 * (`text-beside-control`). `Field` renders the caption as its own label above
 * the box.
 */
describe("the dive-site import form", () => {
  it("draws the file box at md, the size of the submit beside it", () => {
    expect(FORM).toContain('type="file"');
    expect(FORM).toContain('className={controlClassFor("md")}');
    expect(FORM).not.toContain("className={controlClass}");
  });

  it("captions the file box through Field, with no hand-built label wrapping it", () => {
    expect(FORM).toMatch(/<Field label=\{t\("diveSites\.import\.file"\)\}[^>]*>\s*<input/);
    expect(FORM).not.toContain("<label");
  });
});
