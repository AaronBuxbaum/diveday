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
