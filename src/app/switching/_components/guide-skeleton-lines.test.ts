import { describe, expect, it } from "vitest";
import diver from "@/i18n/locales/en-US/diver.json";
import { MIGRATION_GUIDE_SLUGS, MIGRATION_GUIDES } from "@/lib/migration-guides";
import { GUIDE_SKELETON_LINES, SPREADSHEET_SKELETON_LINES } from "./guide-skeleton-lines";

/**
 * **Every guide's skeleton knows how its own words wrap** (K-342, K-410).
 *
 * The line counts are measured, so they cannot be derived here; what can be
 * held is their shape. A guide added to the registry without an entry would
 * paint no skeleton at all, and an entry with a paragraph too few or too many
 * would land the page below it a band's worth off.
 */
describe("the switching guides' skeleton line counts", () => {
  it("has an entry for every registered guide, and for nothing else", () => {
    expect(Object.keys(GUIDE_SKELETON_LINES).sort()).toEqual([...MIGRATION_GUIDE_SLUGS].sort());
  });

  it("draws one paragraph per paragraph of each guide's you-are-here band", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(GUIDE_SKELETON_LINES[guide.slug]?.context, guide.slug).toHaveLength(
        guide.context.length,
      );
      expect(GUIDE_SKELETON_LINES[guide.slug]?.list, guide.slug).toBeUndefined();
    }
  });

  it("draws the spreadsheet guide's two paragraphs and one list item per wedge", () => {
    expect(SPREADSHEET_SKELETON_LINES.context).toHaveLength(2);
    expect(SPREADSHEET_SKELETON_LINES.list).toHaveLength(
      Object.keys(diver.switching.spreadsheet.wedge).length,
    );
  });
});
