import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: `TripRosterContent` is a Server Component behind the trip
 * page's session and a dozen server actions, so this pins the class that
 * decides the wrap; the probe and a person looking at the capture measure it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "TripRosterContent.tsx"), "utf8");

/**
 * **The unmet-demand heading never ends on one word** (pixel-craft class 8,
 * K-504). At 390 it read "This departure could support more / capacity", the
 * last word alone on its line (`departure-load-out-handed-over`). Balanced, the
 * two lines share the words.
 */
describe("the roster's unmet-demand panel", () => {
  it("balances its heading", () => {
    const heading = SOURCE.match(
      /<h2 className=\{`[^`]*`\}>\s*\{t\("trips\.guests\.demandHeading"\)\}/,
    );
    expect(heading?.[0]).toBeDefined();
    expect(heading?.[0]).toContain("text-balance");
  });
});
