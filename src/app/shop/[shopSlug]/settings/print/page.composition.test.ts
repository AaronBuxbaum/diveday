import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: this is a Server Component page behind `requireShopSurface`,
 * so this pins the source that decides the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const SKELETON = readFileSync(join(import.meta.dirname, "loading.tsx"), "utf8");

/**
 * **One rhythm between the page's sections** (pixel-craft class 4). The
 * register's groups stood 32px apart under `mt-8 space-y-8`, where Team and
 * WhatsApp put 40px between sections: one `space-y-10` on the wrapper, never
 * a margin on a section (docs/design/forms-and-controls.md; K-521). The
 * header's own `mb-8` is the gap above the first.
 */
describe("the Print register's section rhythm", () => {
  it("stacks every group in one space-y-10, with no margin of its own", () => {
    expect(SOURCE).toContain('<div className="space-y-10">');
    expect(SOURCE).not.toContain("space-y-8");
    const groups = SOURCE.match(/<LedgerGroup\b[^>]*>/g) ?? [];
    expect(groups.length, "dock, boat, diver and wall").toBe(4);
    for (const group of groups) expect(group).not.toMatch(/\bmt-/);
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the page arrives", () => {
    expect(SKELETON).toContain('<div className="space-y-10">');
    expect(SKELETON).not.toContain("space-y-8");
    expect(SKELETON).not.toMatch(/\bmt-8\b/);
  });
});
