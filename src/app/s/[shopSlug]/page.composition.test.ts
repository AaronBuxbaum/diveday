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
    expect(SOURCE).toContain("{shop.publicYearEnabled ? (");
    expect(SOURCE).not.toContain("isEmbed");
    expect(routeSource(import.meta.dirname, "embed/calendar/page.tsx")).not.toContain(
      "OurYearSection",
    );
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
    expect(SOURCE).toContain("<MonthSightingsSection shop={shop}");
    expect(routeSource(import.meta.dirname, "MonthSightingsShelf.tsx")).toContain(
      "if (!shop.sightingsEnabled) return null;",
    );
  });

  it("reads the month's sightings through an hourly cache keyed on the shop's month", () => {
    const shelf = routeSource(import.meta.dirname, "MonthSightingsShelf.tsx");
    expect(shelf).toContain('"use cache";\n  cacheLife("hours");');
    expect(shelf).toContain("return { sightings, computedAtMs: cacheStamp() };");
    expect(shelf).toContain(
      "publicMonthSightings(shopId, tz, shopMonth, shopRowsCacheGeneration())",
    );
    expect(shelf).toContain('reportCacheRead("month_sightings", cached.computedAtMs, { shopId });');
  });

  it("reads no site sightings for a trip page", () => {
    const reads = routeSource(`${import.meta.dirname}/trips/[id]`, "_lib/page-reads.ts");
    expect(reads).toContain(
      "shop.sightingsEnabled ? siteSightings(db, shop.id, siteIds) : new Map()",
    );
  });
});

/**
 * A short welcome stands above the timetable (Aaron, 2026-11-11, #4336, option B): who the shop is
 * first, the board one scroll later, the full story where it was.
 */
describe("the public schedule's welcome band", () => {
  it("stands above the timetable, and the full story stays below it", () => {
    expect(positionOf("<ShopWelcome")).toBeGreaterThan(-1);
    expect(positionOf("<ShopWelcome")).toBeLessThan(positionOf("<WeekLedger"));
    expect(positionOf("<ShopfrontStory")).toBeGreaterThan(positionOf("<WeekLedger"));
  });

  it("jumps to the board only when there is one and to courses only when the shop teaches", () => {
    expect(SOURCE).toContain('seeScheduleHref={hasUpcoming ? "#schedule" : null}');
    expect(SOURCE).toContain("newToDivingHref={shelfCourses.length > 0");
  });
});
