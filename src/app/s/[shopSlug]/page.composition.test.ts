import { describe, expect, it } from "vitest";
import { routeSource } from "@/test/route-source";

/**
 * The public schedule is a server page that needs a live shop to render, so
 * this reads its source. Its layout is the visual suite's to photograph.
 */
const SOURCE = routeSource(import.meta.dirname, "page.tsx");

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

/**
 * Sightings switched off on Features (ADR 20261005-optional-shop-features):
 * the month's "Seen here" shelf is not read or drawn, and a trip page's day
 * plan gets no sightings beat. Nothing logged is erased.
 */
describe("the public pages with sightings switched off", () => {
  it("draws no month shelf on the schedule", () => {
    expect(SOURCE).toContain("{isEmbed || !shop.sightingsEnabled ? null : (");
    expect(SOURCE.indexOf("<MonthSightingsSection")).toBeGreaterThan(
      SOURCE.indexOf("!shop.sightingsEnabled"),
    );
  });

  it("reads no site sightings for a trip page", () => {
    const reads = routeSource(`${import.meta.dirname}/trips/[id]`, "_lib/page-reads.ts");
    expect(reads).toContain(
      "shop.sightingsEnabled ? siteSightings(db, shop.id, siteIds) : new Map()",
    );
  });
});
