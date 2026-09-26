import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page that needs a database to
 * render, so this pins the source that decides the geometry; nothing here
 * measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/**
 * **Every row on this page that holds a text box is an `md` row.** Each word's
 * rename box stood beside `sm` Save and Delete buttons: one height, and a 16px
 * box beside 14px words, on all six rows of `settings-kinds-of-day` (the pixel
 * probe's `mismatched-controls` cluster, 2026-09-25), and the "Add" row below
 * them had the same pair. A box's type is 16px and stays there, so the buttons
 * take `md` and the boxes stand at md's 48px.
 */
describe("the kinds-of-day rows", () => {
  it("puts every text box at md", () => {
    const boxes = SOURCE.split('type="text"').length - 1;
    expect(boxes, "the rename box and the add box").toBe(2);
    expect(SOURCE.split('controlClassFor("md")').length - 1).toBe(boxes);
    expect(SOURCE).not.toContain("className={controlClass}");
  });

  it("draws no button at sm, and sizes the armed delete's Cancel md through InlineConfirm", () => {
    expect(SOURCE).not.toContain('size: "sm"');
    // The trigger is `flush` on the row's edge and the armed block's confirm is
    // not on that edge, so it takes a class of its own (K-06): the trigger's
    // variant, naming no size, so it follows the trigger's md.
    const confirms = [...SOURCE.matchAll(/confirmClassName=\{buttonClass\(\{[^}]*\}\)\}/g)];
    expect(confirms.length, "every confirmClassName is a buttonClass call").toBe(
      SOURCE.split("confirmClassName").length - 1,
    );
    for (const [confirm] of confirms) {
      expect(confirm, "the confirm follows the trigger's md").not.toMatch(/size:|flush/);
    }
    const armed = SOURCE.slice(
      SOURCE.indexOf("<InlineConfirm"),
      SOURCE.indexOf("/>", SOURCE.indexOf("<InlineConfirm")),
    );
    expect(armed, "the first InlineConfirm is the one with a message").toContain("message=");
    expect(armed).toContain('size="md"');
  });

  /**
   * **Save and Delete share one line** (pixel-craft class 12). Delete had a
   * form of its own after the rename form, and at 390px the row became a 180px
   * block: the box, Save alone on the right, Delete alone on the left. Delete
   * now sits in the rename form's action row and posts to its own action
   * through `InlineConfirm`'s `formAction`.
   */
  it("puts Delete in the rename form, after Save, posting to its own action", () => {
    const row = SOURCE.slice(SOURCE.indexOf("shopLenses.map("), SOURCE.indexOf("createTitle"));
    expect(row.split("<form").length - 1, "one form per word").toBe(1);
    expect(row).not.toContain("action={deleteTripLensAction}");
    expect(row.split("formAction={deleteTripLensAction}").length - 1, "both confirms").toBe(2);
    // Save first in the tree, so Enter in the box renames and never deletes:
    // implicit submission presses a form's first submit button.
    expect(row.indexOf("<SubmitButton")).toBeLessThan(row.indexOf("<InlineConfirm"));
    expect(row, "Save's pending state is the rename's alone").toContain(
      "formAction={updateTripLensAction}",
    );
  });
});
