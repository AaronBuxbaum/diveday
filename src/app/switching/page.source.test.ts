import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the hub body is a cached async Server Component behind the
 * request's locale, so this pins that the page builds its sections from the
 * same box classes its skeleton draws (`_components/hub.tsx`), and paints that
 * skeleton while it streams (K-406).
 */
const SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

describe("the switching hub page", () => {
  it("paints the hub skeleton while its body streams", () => {
    expect(SOURCE).toContain("<Suspense fallback={<SwitchHubBodySkeleton />}>");
    expect(SOURCE).not.toMatch(/function SwitchHubBodySkeleton/);
  });

  it("builds its hero, list, closing row and preview band from the skeleton's own boxes", () => {
    for (const name of [
      "HUB_HERO_CLASS",
      "HUB_LIST_SECTION_CLASS",
      "HUB_CLOSING_ROW_CLASS",
      "HUB_PREVIEW_BAND_CLASS",
      "HUB_PREVIEW_BOX_CLASS",
    ]) {
      expect(SOURCE, name).toContain(`className={${name}}`);
    }
  });
});
