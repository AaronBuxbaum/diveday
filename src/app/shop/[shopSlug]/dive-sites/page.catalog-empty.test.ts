import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the catalog view is a Server Component that needs a database
 * and a shop with no address to render, so this pins the source that decides
 * the geometry; nothing here measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const BRANCH_START = SOURCE.indexOf("if (!locationIsProvided) {");
const BRANCH = SOURCE.slice(BRANCH_START, SOURCE.indexOf("const shopCoordinates", BRANCH_START));

/**
 * **The catalog's "add your address first" state is the catalog's header over
 * the shared empty state** (docs/design/pixel-craft.md, class 11; K-419). It
 * was a bare "Back to library" link over a hand-rolled dashed box — squarer
 * corners, a fainter border, more padding than the library's own empty state
 * one click away, and a `bg-card` fill no token defines, so it painted nothing.
 */
describe("the dive-site catalog without a shop address", () => {
  it("opens on the catalog's own header, then the shared empty state", () => {
    expect(BRANCH_START, "the branch is where this test looks").toBeGreaterThan(-1);
    expect(BRANCH).toContain("<ShopPageHeader");
    expect(BRANCH).toContain('title={t("diveSites.catalog.title")}');
    expect(BRANCH).toContain("<EmptyState");
    expect(BRANCH.indexOf("<ShopPageHeader")).toBeLessThan(BRANCH.indexOf("<EmptyState"));
  });

  it("hand-rolls no empty panel anywhere on the page", () => {
    expect(SOURCE).not.toContain("border-dashed");
    expect(SOURCE).not.toMatch(/\bbg-card\b/);
  });
});
