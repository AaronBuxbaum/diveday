import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { fileScopedShopContext } from "@/test/db";
import { courses, trips } from "./schema";
import { weekBoard } from "./trips";

/**
 * **A course session on the week board is priced as its course** (H-20261014-course-session-price),
 * beside trips-queries.test.ts's week-board suite, which is at its length
 * baseline. Same file-scoped, read-only database and the same frozen week:
 * Mon 2026-07-20 in the demo shop's America/New_York, and the seeded
 * three-day Open Water class in the week after it.
 */
const ctx = fileScopedShopContext();

describe("the week board's course prices", () => {
  const THIS_WEEK = "2026-07-20";
  const COURSE_WEEK = "2026-07-27";
  const TZ = "America/New_York";

  it("prices a course session at the course total the booking charges, never the trip row's own figure", async () => {
    // H-20261014-course-session-price: the public schedule already reads the course's price; the staff
    // board read the trip row's and said $195 where the diver pays $175.
    const { db, shop } = ctx;

    const weeks = [
      await weekBoard(db, shop.id, THIS_WEEK, TZ),
      await weekBoard(db, shop.id, COURSE_WEEK, TZ),
    ];
    const shown = weeks.flatMap((week) => [...Object.values(week.days).flat(), ...week.spans]);
    const rows = await db
      .select({ trip: trips, course: courses })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .where(
        inArray(
          trips.id,
          shown.map((cell) => cell.tripId),
        ),
      );
    const sessions = rows.filter((row) => row.course !== null);
    // The seed has to hold a session whose own price differs from its course's,
    // or this test pins nothing.
    expect(
      sessions.some(
        (row) => perDiverBookingPriceCents(row.trip, row.course) !== row.trip.priceCents,
      ),
    ).toBe(true);
    for (const { trip, course } of sessions) {
      const cell = shown.find((candidate) => candidate.tripId === trip.id);
      expect(cell?.priceCents, trip.title).toBe(perDiverBookingPriceCents(trip, course));
    }
  });
});
