import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the display page is a Server Component behind
 * `requireShopSurface`, so this pins the source that decides the geometry;
 * nothing here measures it.
 *
 * **One inset down the page's column** (K-52, SETTINGS-2-17). "New screen",
 * "Screens" and "Our year on DiveDay" are `lg` cards and start at 453px at
 * 1280. "Where each boat is in its day" and its Save sat at 449: the
 * `WorldPanel` row inside a padding-less `InsetGroup` spelled the `md` inset
 * by hand. The year card reached `lg` only by a `p-5 sm:p-6` className racing
 * the default `md` padding in the stylesheet — right by luck of utility order.
 */
const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");

/** Each `<SectionCard>` opening tag's attributes, up to the first `>`. */
function cardTags(source: string): string[] {
  return source
    .split("<SectionCard")
    .slice(1)
    .map((tag) => /^[^>]*/.exec(tag)?.[0] ?? "");
}

describe("the display page's cards", () => {
  const tags = [...cardTags(read("page.tsx")), ...cardTags(read("DisplayLinksPanel.tsx"))];

  it("take the lg inset through the padding prop", () => {
    expect(tags.length, "every SectionCard on the page is counted").toBeGreaterThanOrEqual(3);
    for (const tag of tags) expect(tag).toMatch(/\bpadding="lg"/);
  });

  it("never pad a card through its className", () => {
    for (const tag of tags) expect(tag).not.toMatch(/className="[^"]*\b(?:sm:)?p[xy]?-\d/);
  });

  it("set the world panel's row at the same inset as the cards around it", () => {
    const world = read("WorldPanel.tsx");
    expect(world.includes('className="p-5 sm:p-6"'), "the row pads at lg").toBe(true);
    expect(world.includes("p-4 sm:p-5"), "the md inset is gone").toBe(false);
  });
});
