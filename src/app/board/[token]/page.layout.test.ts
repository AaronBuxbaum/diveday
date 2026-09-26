import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the board is a Server Component that needs a display token
 * and a database to render, so this pins the classes that decide its geometry;
 * nothing here measures it. The skeleton's half is `loading.test.tsx`.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/**
 * The classes of the first `<tag className="…">` in the page, or of a
 * `` className={`…`} `` template (its `${…}` holes dropped).
 */
function classesOf(tag: string): string[] {
  const match = SOURCE.match(new RegExp(`<${tag}\\s+className=(?:"([^"]+)"|\\{\`([^\`]+)\`\\})`));
  expect(match, `the page has a <${tag} className=…>`).not.toBeNull();
  return (match?.[1] ?? match?.[2] ?? "")
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Every element in the page that carries an `lg:grid-cols-[…]` template, in
 * source order: its classes, and the template's tracks.
 */
function templates(): { classes: string[]; tracks: string[] }[] {
  const found: { classes: string[]; tracks: string[] }[] = [];
  for (const match of SOURCE.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const classes = (match[1] ?? match[2] ?? "")
      .replace(/\$\{[^}]*\}/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const template = classes.find((token) => token.startsWith("lg:grid-cols-["));
    if (template) {
      found.push({ classes, tracks: template.slice("lg:grid-cols-[".length, -1).split("_") });
    }
  }
  return found;
}

describe("the departures board's header", () => {
  /**
   * **The date shares the shop name's last baseline** (K-256). `items-end`
   * lined up the two line boxes' bottoms, and a 44px heading's descent is
   * deeper than a 28px date's, so the date sat 4px under the name at 1280.
   * The last baseline, not the first, so a name that wraps keeps the date on
   * its last line.
   */
  it("sets the date on the shop name's last baseline", () => {
    const header = classesOf("header");
    expect(header).toContain("items-baseline-last");
    expect(header).not.toContain("items-end");
  });
});

describe("the departures board's columns", () => {
  /**
   * **One time column for the whole board** (K-467). Each row carried its own
   * `lg:grid-cols-[auto_1fr_auto]`, so each sized its `auto` time column to
   * its own time: "5:30 AM" put its title at x 298 and "2:30 PM" at 294, and
   * a "10:30 AM" row would push its title a digit further right. The list owns
   * the time column; each row spans the list's two columns as a subgrid, so
   * every title starts after the widest time.
   */
  it("gives the list the time column and each departure a subgrid of it", () => {
    const list = classesOf("ol");
    expect(list).toContain("lg:grid-cols-[auto_1fr]");

    const row = classesOf("li");
    expect(row).toEqual(expect.arrayContaining(["lg:col-span-2", "lg:grid-cols-subgrid"]));
    expect(row.filter((token) => token.startsWith("lg:grid-cols-["))).toEqual([]);
  });

  /**
   * **Only the time column is shared.** An `auto` track grows to its widest
   * item's max-content before a `1fr` track gets anything, so a shared stage
   * column is as wide as the widest stage on the whole board: one boat "Out on
   * Molasses Reef" (about 370px at 36px bold) took about 113px from every
   * other row's title at 1280, and at 1024 left the titles about 229px, broken
   * word by word. Each row sizes its own stage and count, as it did before
   * K-467, so only the row that is out gives its title that room.
   */
  it("shares no column after the time, so each row sizes its own stage and count", () => {
    const [list, own, ...others] = templates();

    // The list's template is exactly two tracks: the time, and one `1fr` for
    // everything after it. A third track there is a shared `auto` column.
    expect(list?.classes).toEqual(classesOf("ol"));
    expect(list?.tracks).toEqual(["auto", "1fr"]);

    // The stage and count are an `auto` column inside each row's `1fr`.
    expect(own?.tracks).toEqual(["minmax(0,1fr)", "auto"]);
    // Stacked below `lg`, the title and the stage stand 12px apart, as they
    // did when they were the row's own children.
    expect(own?.classes).toEqual(
      expect.arrayContaining(["grid", "min-w-0", "gap-y-3", "lg:items-center"]),
    );
    expect(others).toEqual([]);
  });

  it("keeps the gap between the columns the row's own", () => {
    // A subgrid whose column gap differs from its parent's shifts its edge
    // items by half the difference; both say 2rem, so nothing moves.
    expect(classesOf("ol")).toContain("lg:gap-x-8");
    expect(classesOf("li")).toContain("gap-x-8");
  });
});
