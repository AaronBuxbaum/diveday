// @vitest-environment jsdom
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RemovablePhoto, removablePhotoGridClass } from "./RemovablePhoto";

afterEach(cleanup);

const ROOT = path.join(import.meta.dirname, "..", "..");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(relative)));
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) files.push(relative);
  }
  return files;
}

/**
 * **Taking a stored photo back off is one drawing.** It was three: the course
 * hero was a thumbnail beside a visible checkbox, the course gallery a
 * bordered photo with a tick, and the dive-site editor the same photo without
 * the tick, although its own doc said it was "the same shape the course
 * editor's gallery uses" (the pixel audit, course-edit and dive-site-edit).
 *
 * And none of them showed focus: the checkbox is `sr-only`, a clipped 1px box,
 * so the global ring drew on nothing a person could see.
 */
describe("RemovablePhoto", () => {
  it("posts the photo's own name and value when ticked, and says what the tick does", () => {
    render(
      <RemovablePhoto
        url="/dive-sites/molasses.jpg"
        name="removeGalleryUrls"
        value="/dive-sites/molasses.jpg"
        label="Remove"
      />,
    );

    const box = screen.getByRole("checkbox", { name: "Remove" });
    expect(box).toHaveAttribute("name", "removeGalleryUrls");
    expect(box).toHaveAttribute("value", "/dive-sites/molasses.jpg");
    expect(box).toHaveClass("peer", "sr-only");
  });

  it("posts `true` for a single-photo field", () => {
    render(
      <RemovablePhoto url="/dive-sites/map.jpg" name="removeHero" label="Remove current photo" />,
    );
    expect(screen.getByRole("checkbox", { name: "Remove current photo" })).toHaveAttribute(
      "value",
      "true",
    );
  });

  it("draws the photo, the tick and the caption, and rings the photo when the box has focus", () => {
    render(<RemovablePhoto url="/dive-sites/map.jpg" name="removeHero" label="Remove" />);

    const box = screen.getByRole("checkbox", { name: "Remove" });
    const photo = box.nextElementSibling;
    expect(photo).toHaveClass("h-24", "w-full", "rounded-lg", "border-2", "border-border");
    expect(photo).toHaveClass("peer-checked:border-danger", "peer-focus-visible:focus-ring");
    const tick = photo?.nextElementSibling;
    expect(tick).toHaveAttribute("aria-hidden", "true");
    expect(tick?.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Remove")).toHaveClass("peer-checked:text-danger");
  });

  it("sizes a full-width field's photos by one grid, so a lone photo is a gallery cell", () => {
    expect(removablePhotoGridClass).toBe("grid grid-cols-2 gap-3 sm:grid-cols-3");
  });

  /**
   * The drift started as a copy: the dive-site editor re-drew the course
   * gallery's cell by hand and left the tick behind. A `StoredPhoto` beside a
   * checkbox anywhere else is the next copy.
   */
  it("is the only place a stored photo sits beside a checkbox", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles("src")) {
      if (file === path.join("src", "components", "RemovablePhoto.tsx")) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      if (source.includes("<StoredPhoto") && /type="checkbox"/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
