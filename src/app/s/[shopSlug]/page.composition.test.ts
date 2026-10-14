import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The public schedule is a server page that needs a live shop to render, so
 * this reads its source. Its layout is the visual suite's to photograph.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

/**
 * "Our year" is the shop's own counts, so it renders only with its yes and
 * never inside somebody else's website (the embed).
 */
describe("the public schedule's Our year panel", () => {
  it("is gated on the shop's switch and kept out of the embed", () => {
    expect(SOURCE).toContain("{!isEmbed && shop.publicYearEnabled ? (");
    expect(positionOf("<OurYearSection")).toBeGreaterThan(positionOf("<ScheduleReviewsSection"));
  });
});
