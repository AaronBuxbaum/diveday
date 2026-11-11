import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { courses, diveSites } from "./schema";
import { pagedUpcomingTripsWithCounts } from "./trips";

/**
 * The board reads a course and a dive site without the wide columns no board
 * renders (performance audit 2026-11-11, item 5). Every column it does carry
 * must come back with the same value the row holds, and the dropped ones must
 * not come back at all.
 */
const ctx = fileScopedShopContext();

const DROPPED_COURSE = [
  "sourceTemplateSnapshot",
  "overview",
  "galleryPhotos",
  "includes",
  "excludes",
  "scheduleDays",
  "faqs",
  "learningMaterials",
] as const;

function without<T extends Record<string, unknown>>(row: T, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

describe("the board's course and dive-site columns", () => {
  it("carries every other column with the row's own value", async () => {
    const { db, shop } = ctx;
    const { trips } = await pagedUpcomingTripsWithCounts(db, shop.id, { limit: 100 });
    const withCourse = trips.filter((trip) => trip.course);
    const withSite = trips.filter((trip) => trip.diveSite);
    expect(withCourse.length).toBeGreaterThan(0);
    expect(withSite.length).toBeGreaterThan(0);

    for (const trip of withCourse) {
      const [row] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, trip.course?.id ?? ""));
      expect(row).toBeDefined();
      expect(trip.course).toEqual(without(row ?? {}, DROPPED_COURSE));
      for (const key of DROPPED_COURSE) expect(trip.course).not.toHaveProperty(key);
    }
    for (const trip of withSite) {
      const [row] = await db
        .select()
        .from(diveSites)
        .where(eq(diveSites.id, trip.diveSite?.id ?? ""));
      expect(trip.diveSite).toEqual(without(row ?? {}, ["templateUpdateUndo"]));
      expect(trip.diveSite).not.toHaveProperty("templateUpdateUndo");
    }
    // A departure with no course still reads null, not an empty object.
    expect(trips.some((trip) => trip.course === null)).toBe(true);
  });
});
