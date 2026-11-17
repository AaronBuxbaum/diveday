// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking, restoreBooking } from "./bookings";
import type { AppDb } from "./client";
import { courses } from "./schema";
import { createTrip, getTripRoster, listStaff, setTripCrew } from "./trips";

// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/**
 * Issue #4633 (Aaron, 2026-11-16, option A). A pool session of an intro course
 * sells to the Instructor Manual's confined-water DSD figure (HD-6): 4 per
 * instructor, no assistant bonus. A boat intro session keeps 2, and the pool
 * half of an Open Water course keeps its 8/+2/12 cap. Capacity 12 on every
 * departure, so only the ratio can refuse anything.
 */
describe("the course ratio on a pool session (issue #4633)", () => {
  const POOL_OFFSET_MS = 200 * 24 * 60 * 60 * 1000;
  let slot = 0;

  async function session(
    db: AppDb,
    shopId: string,
    courseTitle: string,
    diveMode: "boat" | "pool",
    crew: Array<"instructor" | "divemaster">,
  ) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shopId), eq(courses.title, courseTitle)));
    if (!course) throw new Error(`${courseTitle} course missing`);
    const staff = await listStaff(db, shopId);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const divemaster = staff.find(
      (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
    );
    if (!instructor || !divemaster) throw new Error("seeded crew missing");
    // Each session its own six-hour slot, clear of every other's crew.
    const startsAt = nowMs() + POOL_OFFSET_MS + slot++ * 6 * 60 * 60 * 1000;
    const trip = await createTrip(db, {
      shopId,
      courseId: course.id,
      title: `${courseTitle} — ${diveMode} ratio test`,
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + 3 * 60 * 60 * 1000),
      capacity: 12,
      plannedDives: 1,
      diveMode,
    });
    if (!trip) throw new Error("failed to create session");
    const members = crew.map((role) => ({
      personId: role === "instructor" ? instructor.person.id : divemaster.person.id,
      tripRole: role,
    }));
    if (!(await setTripCrew(db, shopId, trip.id, members))) {
      throw new Error("failed to roster crew");
    }
    return trip;
  }

  async function fill(db: AppDb, shopId: string, tripId: string, count: number, tag: string) {
    const outcomes = [];
    for (let i = 0; i < count; i += 1) {
      outcomes.push(
        await createBooking(db, {
          actor: "staff",
          shopId,
          tripId,
          fullName: `Pool Ratio ${tag} ${i}`,
          email: `pool-ratio-${tag}-${i}@example.com`,
        }),
      );
    }
    return outcomes;
  }

  it("seats a fourth student on an intro pool session and refuses the fifth", async () => {
    const { db, shop } = ctx;
    const trip = await session(db, shop.id, "Discover Scuba Diving", "pool", ["instructor"]);
    const outcomes = await fill(db, shop.id, trip.id, 5, "dsd-pool");
    expect(outcomes.slice(0, 4).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[4]).toMatchObject({ ok: false, reason: "course_ratio_full" });
    expect(await getTripRoster(db, shop.id, trip.id)).toHaveLength(4);
  });

  it("keeps a boat intro session at 2 per instructor", async () => {
    const { db, shop } = ctx;
    const trip = await session(db, shop.id, "Discover Scuba Diving", "boat", ["instructor"]);
    const outcomes = await fill(db, shop.id, trip.id, 3, "dsd-boat");
    expect(outcomes.slice(0, 2).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[2]).toMatchObject({ ok: false, reason: "course_ratio_full" });
  });

  it("lets no assistant raise an intro pool session past 4", async () => {
    const { db, shop } = ctx;
    const trip = await session(db, shop.id, "Discover Scuba Diving", "pool", [
      "instructor",
      "divemaster",
    ]);
    const outcomes = await fill(db, shop.id, trip.id, 5, "dsd-pool-dm");
    expect(outcomes.slice(0, 4).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[4]).toMatchObject({ ok: false, reason: "course_ratio_full" });
  });

  it("refuses an undo that would put a fifth student on an intro pool session", async () => {
    const { db, shop } = ctx;
    const trip = await session(db, shop.id, "Discover Scuba Diving", "pool", ["instructor"]);
    const [first, ...rest] = await fill(db, shop.id, trip.id, 4, "dsd-pool-undo");
    if (!first?.ok || !rest.every((outcome) => outcome.ok)) throw new Error("setup failed");
    await cancelBooking(db, shop.id, first.bookingId);
    expect(await fill(db, shop.id, trip.id, 1, "dsd-pool-walk-up")).toMatchObject([{ ok: true }]);

    expect(await restoreBooking(db, shop.id, first.bookingId)).toBe("course_ratio_full");
    expect(await getTripRoster(db, shop.id, trip.id)).toHaveLength(4);
  });

  it("keeps the pool half of an Open Water course at 8 per instructor", async () => {
    const { db, shop } = ctx;
    const trip = await session(db, shop.id, "Open Water Diver", "pool", ["instructor"]);
    const outcomes = await fill(db, shop.id, trip.id, 9, "ow-pool");
    expect(outcomes.slice(0, 8).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[8]).toMatchObject({ ok: false, reason: "course_ratio_full" });
  });
});
