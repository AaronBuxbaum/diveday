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
    expect(SOURCE, "the confirm follows the trigger's md").not.toContain("confirmClassName");
    const armed = SOURCE.slice(
      SOURCE.indexOf("<InlineConfirm"),
      SOURCE.indexOf("/>", SOURCE.indexOf("<InlineConfirm")),
    );
    expect(armed, "the first InlineConfirm is the one with a message").toContain("message=");
    expect(armed).toContain('size="md"');
  });
});
