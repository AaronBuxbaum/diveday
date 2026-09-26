import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 * `CsvFileInput` is what draws the picker; its drawing is its own.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const FORM = SOURCE.slice(SOURCE.indexOf("<form"), SOURCE.indexOf("</form>"));

/**
 * **The file picker is a button, drawn the way Settings draws one.** The form
 * rendered a bare `<input type="file">` in a text-box outline, and preflight
 * strips the picker's own button, so "Choose File No file chosen" read as
 * plain text in a box, with no hover (K-350, ATLAS-3-15). Import gear history,
 * one row above it in the same Settings group, renders `CsvFileInput`: a
 * secondary `md` button in the shop's language, the same height as the
 * "Import dive sites" submit beside it.
 */
describe("the dive-site import form", () => {
  it("picks its file with the shared CsvFileInput, not a bare file input", () => {
    expect(FORM).toMatch(/<CsvFileInput\s[^>]*name="file"/);
    expect(FORM).toMatch(/<CsvFileInput\s[^>]*required/);
    expect(FORM).not.toContain('type="file"');
  });

  it("names the picker in the shop's language", () => {
    expect(FORM).toContain('choose: t("diveSites.import.chooseFile")');
    expect(FORM).toContain('chooseAnother: t("diveSites.import.chooseDifferentFile")');
  });
});
