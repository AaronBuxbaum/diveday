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
   * the template; each row spans it as a subgrid, so every title starts after
   * the widest time.
   */
  it("gives the list the three columns and each departure a subgrid of them", () => {
    const list = classesOf("ol");
    expect(list).toContain("lg:grid-cols-[auto_1fr_auto]");

    const row = classesOf("li");
    expect(row).toEqual(expect.arrayContaining(["lg:col-span-3", "lg:grid-cols-subgrid"]));
    expect(row.filter((token) => token.startsWith("lg:grid-cols-["))).toEqual([]);
  });

  it("keeps the gap between the columns the row's own", () => {
    // A subgrid whose column gap differs from its parent's shifts its edge
    // items by half the difference; both say 2rem, so nothing moves.
    expect(classesOf("ol")).toContain("lg:gap-x-8");
    expect(classesOf("li")).toContain("gap-x-8");
  });
});
