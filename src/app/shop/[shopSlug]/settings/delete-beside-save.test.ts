import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: these are Server Component pages that need a database to
 * render, so this pins the source that decides the geometry; nothing here
 * measures it.
 *
 * **A row's Delete sits in its edit form, beside Save** (pixel-craft class
 * 12). Each boat drew Delete in a form of its own after the edit form,
 * because `InlineConfirm` submits the form it sits in and forms cannot nest,
 * which put Delete on a line under Save. `InlineConfirm`'s `formAction` lets
 * the confirm post to the delete from inside the edit form. Trip tags' rows
 * are pinned beside their own page, in `trip-tags/page.control-rows.test.ts`.
 */
const PAGES = [{ page: "boats", update: "updateBoatAction", remove: "deleteBoatAction" }] as const;

describe.each(PAGES)("the $page rows", ({ page, update, remove }) => {
  const source = readFileSync(join(import.meta.dirname, page, "page.tsx"), "utf8");
  const edit = source.slice(source.indexOf(`action={${update}}`), source.indexOf("createTitle"));

  it("has no form of its own for Delete", () => {
    expect(source).not.toContain(`action={${remove}}`);
  });

  it("posts every Delete confirm to the delete from inside the edit form, after Save", () => {
    const confirms = edit.split("<InlineConfirm").length - 1;
    expect(confirms).toBeGreaterThan(0);
    expect(edit.split(`formAction={${remove}}`).length - 1).toBe(confirms);
    // Enter in a field presses the form's first submit button: that must be
    // Save, never the delete.
    expect(edit.indexOf("<SubmitButton")).toBeLessThan(edit.indexOf("<InlineConfirm"));
    expect(edit, "Save's pending state is the edit's alone").toContain(`formAction={${update}}`);
  });
});
