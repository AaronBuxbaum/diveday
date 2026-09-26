import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** Each `<Link …>` on the page, up to the end of its opening tag's props. */
const LINKS = SOURCE.split("<Link")
  .slice(1)
  .map((link) => link.slice(0, link.indexOf(">")));

/**
 * **The register's two text doors are one door** (pixel-craft class 12). The
 * paper pass's "On the counter" was `text-muted` and the year poster's "Opens
 * Reports" `text-primary`, and neither changed on hover, where every other
 * text door in the app underlines (K-538).
 */
describe("the Print register's text doors", () => {
  it("draws both in one ink, with the app's text-door hover", () => {
    expect(LINKS).toHaveLength(2);
    for (const link of LINKS) {
      expect(link).toContain("className={TEXT_DOOR_CLASS}");
    }
    const door = SOURCE.match(/const TEXT_DOOR_CLASS = `([^`]*)`/)?.[1] ?? "";
    expect(door).toMatch(/^\$\{tapTargetLinkClass\} /);
    expect(door.split(/\s+/)).toEqual(
      expect.arrayContaining(["text-sm", "font-medium", "text-primary", "hover:underline"]),
    );
    expect(door).not.toContain("text-muted");
  });
});

/**
 * **A status line never opens on its separator** (pixel-craft class 8). The
 * line and its status were one string joined by " · ", an ordinary space each
 * side of the dot, so at 390 the dock sign's second line began "· Never
 * printed" (K-590). The dot is glued to the words before it by a no-break
 * space, and the status is one unit.
 */
describe("the Print register's status line", () => {
  it("glues the separator to the line and keeps the status whole", () => {
    const row = SOURCE.slice(SOURCE.indexOf("function SheetRow"));
    expect(row).not.toMatch(/\$\{line\} · \$\{meta\}/);
    expect(row).toContain('{"\\u00a0· "}');
    expect(row).toMatch(/<span className="whitespace-nowrap">\{meta\}<\/span>/);
  });
});
