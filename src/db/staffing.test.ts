// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, courses, people, staffShifts, tripAssignments } from "./schema";
import { createStaffShift, crewShiftCoverage, getStaffingView } from "./staffing";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";

/**
 * 180 days out, matching src/db/courses.test.ts's OPEN_TEST_SESSION_OFFSET_MS
 * reasoning: far enough past the seeded demo's instructor calendar (day 75)
 * that a synthetic session never collides with the seed's real crew overlaps.
 */
const OPEN_TEST_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

describe("staffing view", () => {
  it("shows roles, working windows, teaching/crew capabilities, and coverage gaps", async () => {
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!instructor || !trip) throw new Error("seeded staffing fixture missing");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);

    const shift = await createStaffShift(db, {
      shopId: shop.id,
      personId: instructor.person.id,
      startsAt: new Date(trip.startsAt.getTime() - 30 * 60 * 1000),
      endsAt: new Date(trip.endsAt.getTime() + 30 * 60 * 1000),
      note: "Dock and classroom",
      createdByPersonId: instructor.person.id,
    });
    expect(shift.ok).toBe(true);

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    const working = view.staff.find((entry) => entry.person.id === instructor.person.id);
    expect(working?.capabilities).toEqual(expect.arrayContaining(["teach", "crew"]));
    expect(working?.shifts).toHaveLength(1);
    expect(view.trips[0]?.coveredByShift).toBe(true);
  });

  it("rejects overlapping shifts for one staff member and scopes writes to the shop", async () => {
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded staff missing");
    const startsAt = new Date("2026-07-29T12:00:00.000Z");
    const first = await createStaffShift(db, {
      shopId: shop.id,
      personId: staff.person.id,
      startsAt,
      endsAt: new Date("2026-07-29T14:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    const overlap = await createStaffShift(db, {
      shopId: shop.id,
      personId: staff.person.id,
      startsAt: new Date("2026-07-29T13:00:00.000Z"),
      endsAt: new Date("2026-07-29T15:00:00.000Z"),
    });
    expect(overlap).toEqual({ ok: false, reason: "overlap" });

    const [person] = await db.select().from(people).where(eq(people.id, staff.person.id));
    expect(person?.shopId).toBe(shop.id);
  });

  // The one "course crew gap" computation (Lens 17 task 151): an entry-level
  // PADI session with an instructor but no assistant, booked past the 8-seat
  // solo-instructor ratio, is *still* a coverage gap — the old boolean
  // "has an instructor?" check would have called this trip covered.
  // `createBooking` refuses to *sell* a seat past the ratio, so the 9th seat
  // here is inserted directly — standing in for a trip a data import, a
  // since-tightened rule, or a crew member calling in sick left in that state
  // (crew changes are always recorded, never refused), which is exactly the
  // case staff need the warning for.
  /**
   * Stands up an instructor-crewed session on `courseTitle`, seats `withinRatio`
   * divers through the booking gate, then inserts one more seat *directly* to
   * push it over — see the note above for why the extra seat bypasses
   * `createBooking`. Returns the trip's staffing-view entry.
   */
  async function overRatioSessionEntry(
    courseTitle: string,
    withinRatio: number,
    tag: string,
  ): Promise<{ gaps: string[] } | undefined> {
    const { db, shop } = await seededShopContext();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, courseTitle)));
    if (!course) throw new Error(`${courseTitle} course missing`);
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: `Ratio-over-capacity session (${tag})`,
      startsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create ratio test trip");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    for (let i = 0; i < withinRatio; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `Ratio Diver ${i}`,
        email: `staffing-${tag}-diver-${i}@example.com`,
      });
      expect(outcome).toMatchObject({ ok: true });
    }
    const [extraDiver] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: `Ratio Diver ${withinRatio}`,
        email: `staffing-${tag}-diver-${withinRatio}@example.com`,
      })
      .returning();
    if (!extraDiver) throw new Error("failed to insert extra diver");
    await db.insert(bookings).values({ shopId: shop.id, tripId: trip.id, personId: extraDiver.id });

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    return view.trips.find((row) => row.trip.id === trip.id);
  }

  it("flags course_needs_instructor for a ratio-over-capacity trip even though it has an instructor", async () => {
    // Open Water training dives: 8 through the gate, the 9th inserted directly.
    const entry = await overRatioSessionEntry("Open Water Diver", 8, "ow");
    expect(entry?.gaps).toContain("course_needs_instructor");
  });

  it("flags an over-ratio intro (Discover Scuba) session at its far tighter 2:1 cap", async () => {
    // The same advisory at the Instructor Manual DSD ratio (DOM-H2, HD-6): 2
    // through the gate, the 3rd inserted directly. Under the old 8/12 numbers
    // this trip read as covered.
    const entry = await overRatioSessionEntry("Discover Scuba Diving", 2, "dsd");
    expect(entry?.gaps).toContain("course_needs_instructor");
  });

  /**
   * DOM-M3. The coverage list, the trip page, the Today queue, and the booking
   * gate all ask "is this course session staffed" and all used to answer it
   * from shop-wide roles alone, so an instructor rostered as this trip's deck
   * hand cleared the gap on his own. One definition now decides it
   * (`countInWaterCrew`, src/lib/crew-roles.ts).
   */
  it("does not let an instructor rostered as deck crew cover a course session", async () => {
    const { db, shop } = await seededShopContext();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Per-trip role coverage session",
      startsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 2 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + OPEN_TEST_SESSION_OFFSET_MS + 6 * 60 * 60 * 1000),
      capacity: 10,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");

    const gapsFor = async () => {
      const view = await getStaffingView(
        db,
        shop.id,
        new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
        new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
      );
      return view.trips.find((row) => row.trip.id === trip.id)?.gaps ?? [];
    };

    // Written straight to the row: `setTripCrew` now refuses to leave a course
    // session with nobody on the ratio (review 20260803, D8), and the staffing
    // view still has to read such a row truthfully — it can arrive from an
    // import, or from a qualification revoked after the roster was set.
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );
    expect(await gapsFor()).toContain("course_needs_instructor");

    // The same person, rostered to the job he is actually doing.
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: instructor.person.id, tripRole: "instructor" },
      ]),
    ).toBe(true);
    expect(await gapsFor()).not.toContain("course_needs_instructor");

    // And an unspecified role stays the status quo.
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    expect(await gapsFor()).not.toContain("course_needs_instructor");
  });

  it("shows a staff member's crewed trips on their staffing card", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!instructor || !trip) throw new Error("seeded staffing fixture missing");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    const working = view.staff.find((entry) => entry.person.id === instructor.person.id);
    expect(working?.crewingTrips).toEqual(
      expect.arrayContaining([expect.objectContaining({ tripId: trip.id, title: trip.title })]),
    );
  });
});

describe("crewShiftCoverage", () => {
  it("reports which of a trip's crew have a shift overlapping the trip window", async () => {
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const staff = await listStaff(db, shop.id);
    const [onShift, offShift] = staff;
    if (!onShift || !offShift) throw new Error("seeded staffing fixture needs two staff");
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded upcoming trip missing");

    const shift = await createStaffShift(db, {
      shopId: shop.id,
      personId: onShift.person.id,
      startsAt: new Date(trip.startsAt.getTime() - 30 * 60 * 1000),
      endsAt: new Date(trip.endsAt.getTime() + 30 * 60 * 1000),
    });
    expect(shift.ok).toBe(true);

    const covered = await crewShiftCoverage(db, shop.id, trip, [
      onShift.person.id,
      offShift.person.id,
    ]);
    expect(covered.has(onShift.person.id)).toBe(true);
    expect(covered.has(offShift.person.id)).toBe(false);
  });

  it("returns an empty set for no crew, without querying", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded upcoming trip missing");
    expect(await crewShiftCoverage(db, shop.id, trip, [])).toEqual(new Set());
  });
});
