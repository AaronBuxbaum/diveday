import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page that needs a database to
 * render, so this pins the source that decides the geometry; nothing here
 * measures it. `Field`'s own tests pin that its caption is a visible
 * `<label>` pointing at the control.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const CREATE = SOURCE.slice(SOURCE.indexOf("<AddPanel"), SOURCE.indexOf("</AddPanel>"));

/** Each opening tag carrying `name="description"`, whatever its element. */
function descriptionControls(source: string): string[] {
  return [...source.matchAll(/<(\w+)\b[^>]*?name="description"[^>]*?>/gs)].map(([tag]) => tag);
}

/**
 * **The add form says what each box is for, and keeps saying it.** Its only
 * labels were placeholders, which a box clips and a keystroke erases: at 1280
 * the 128px capacity box read "Capacity (se", and at 390 the description box
 * hid twenty characters of its own label (K-145, SETTINGS-2-03). Each box now
 * stands under a `Field` caption, as the seasons form beside it does.
 */
describe("the boats add form", () => {
  it("captions every box with a Field, not a placeholder", () => {
    for (const key of ["boats.nameLabel", "boats.capacityLabel", "boats.descriptionLabel"]) {
      expect(CREATE).toMatch(
        new RegExp(`<Field\\s+label=\\{t\\("${key.replace(".", "\\.")}"\\)\\}`),
      );
    }
    expect(CREATE).not.toContain("placeholder=");
    expect(CREATE).not.toContain("aria-label=");
  });

  it("is a FieldGrid form whose submit stands in FieldActions", () => {
    expect(CREATE).toMatch(/<FieldGrid\s+as="form"[^>]*action=\{createBoatAction\}/);
    expect(CREATE).toContain("<FieldActions>");
  });
});

/**
 * **A boat's description reads whole.** It was a one-line text box for a
 * value of up to 200 characters, so the seed's 72-character line lost "ded
 * deck, ten minutes to the reef." at 390 and its last two letters at 1280
 * (K-446, SETTINGS-2-39). Both description boxes are textareas that grow with
 * their text, never shorter than two lines.
 */
describe("the boat description", () => {
  it("is a growing textarea in the row form and the add form alike", () => {
    const controls = descriptionControls(SOURCE);
    expect(controls, "one per row form, one in the add form").toHaveLength(2);
    for (const tag of controls) {
      expect(tag.startsWith("<textarea")).toBe(true);
      expect(tag).toContain("rows={2}");
      expect(tag).toContain("className={textareaClassFor(2)}");
      expect(tag).toContain("maxLength={200}");
    }
  });
});
