import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import type { TodayAction } from "@/lib/today";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  courses,
  personRoles as personRolesTable,
  tripAssignments,
  trips as tripsTable,
} from "./schema";
import { getStaffingView } from "./staffing";
import { getTodayWork } from "./today";
import { pushCrewGapRows } from "./today-crew-gap-rows";
import { NOW, rowsContext } from "./today-rows-test-fixtures";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date(NOW.getTime() + 24 * 3_600_000),
  course: null,
  booked: 8,
  bookedDivers: 8,
  selfGuided: false,
} as never;
const where = {
  trip,
  when: "8:00 AM",
  departure: { tripId: "trip-1", label: "Two-Tank Reef · 8:00 AM" },
  tripHref: "/shop/blue-mantis/trips/trip-1",
};

function rows(wave: Record<string, unknown>, overrides = {}): TodayAction[] {
  const actions: TodayAction[] = [];
  pushCrewGapRows(actions, rowsContext(wave, overrides), where);
  return actions;
}

describe("pushCrewGapRows", () => {
  it("says a boat with divers and nobody rostered has no crew", () => {
    const [row, ...rest] = rows({ courseCrewCounts: new Map() });
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ kind: "uncrewed_departure", aboutDeparture: true });
    expect(row?.href).toBe("/shop/blue-mantis/trips/trip-1?view=details#crew");
  });

  it("raises nothing on a departure the shop marked self-guided", () => {
    const actions: TodayAction[] = [];
    pushCrewGapRows(actions, rowsContext({ courseCrewCounts: new Map() }), {
      ...where,
      trip: { ...(trip as object), selfGuided: true } as never,
    });
    expect(actions).toEqual([]);
  });

  it("raises nothing when the shop sets no divemaster target", () => {
    expect(rows({ courseCrewCounts: new Map() }, { diversPerDivemaster: null })).toEqual([]);
  });
});

/** One database for the file, one transaction per test (`fileScopedShopContext`, src/test/db.ts). */
const ctx = fileScopedShopContext();

/**
 * DOM-M3. Today, the staffing coverage list, the trip page, and the booking
 * gate all ask "is this course session staffed", and all four used to answer
 * it from shop-wide roles alone — so an instructor rostered as this trip's
 * deck hand cleared `instructor_missing` on his own. Two safety surfaces
 * disagreeing is worse than either being wrong alone, so this asserts the
 * agreement directly: one definition (`countInWaterCrew`, src/lib/crew-roles.ts).
 */
describe("Today and the staffing view count crew the same way (DOM-M3)", () => {
  async function courseSessionToday() {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Per-trip role session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Inserted directly rather than through `setTripCrew`: the seeded
    // instructor already crews a boat in this window, and the overlap refusal
    // is not what this test is about.
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    return { db, shop, trip, instructorId: instructor.person.id };
  }

  /**
   * Today's verdict on this one session, and the roster's window-wide
   * needs-crew count taken alongside it. The roster no longer names a
   * per-trip gap — its whole crewing surface is that count — so agreement is
   * asserted as a delta: when Today flags the session, exactly one more
   * departure in the window needs crew.
   */
  async function readBoth(
    db: Awaited<ReturnType<typeof courseSessionToday>>["db"],
    shop: Awaited<ReturnType<typeof courseSessionToday>>["shop"],
    trip: { id: string; startsAt: Date; endsAt: Date },
  ) {
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    return {
      today: work.actions.some(
        (action) => action.kind === "instructor_missing" && action.id === `instructor:${trip.id}`,
      ),
      needCrew: view.crewGaps.needCrew,
    };
  }

  it("agrees that a rostered deck hand does not staff the session, and that the instructor does", async () => {
    const { db, shop, trip, instructorId } = await courseSessionToday();
    // No per-trip role: the status quo, and both surfaces say it is staffed.
    const staffed = await readBoth(db, shop, trip);
    expect(staffed.today).toBe(false);

    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, instructorId)));
    const asDeckHand = await readBoth(db, shop, trip);
    expect(asDeckHand.today).toBe(true);
    // The agreement itself: Today flagged one more session, and the roster's
    // count rose by exactly one.
    expect(asDeckHand.needCrew).toBe(staffed.needCrew + 1);

    await db
      .update(tripAssignments)
      .set({ tripRole: "instructor" })
      .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, instructorId)));
    const asInstructor = await readBoth(db, shop, trip);
    expect(asInstructor.today).toBe(false);
    expect(asInstructor.needCrew).toBe(staffed.needCrew);
  });
});

/**
 * Issue #732. `divemasterRatioGap` (src/lib/divemaster-ratio.ts) "applies to
 * every dive the shop runs, fun dives and course sessions alike", but before
 * this it reached Today nowhere — a fun dive with divers booked and nobody
 * rostered raised no row at all, while a missing rental size did. These
 * assert both new rows, and that the boundary with `instructor_missing`
 * (agency ratios, course-only) stays exactly where it was.
 */
describe("uncrewed and below-target departures (issue #732)", () => {
  async function reefTrip(db: ReturnType<typeof fileScopedShopContext>["db"], shopId: string) {
    const trips = await upcomingTripsWithCounts(db, shopId);
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    return reef;
  }

  /**
   * The reef trip with both of its crew still aboard and neither in the water:
   * the captain on the lines and the divemaster driving (tripRole "crew" and
   * "captain", the DOM-M3 shape). Neither counts toward the in-water ratio
   * (src/lib/crew-roles.ts), so the trip is uncrewed by the rule the ratio
   * itself uses. The seed used to roster today's reef boat this way; it no
   * longer does (UX audit 2026-10-07, item 4), so each case says it here.
   */
  async function uncrewedReefTrip(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    shopId: string,
  ) {
    const reef = await reefTrip(db, shopId);
    const crew = await db
      .select({ personId: tripAssignments.personId, role: personRolesTable.role })
      .from(tripAssignments)
      .innerJoin(personRolesTable, eq(personRolesTable.personId, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, reef.id));
    expect(crew.length).toBeGreaterThan(0);
    for (const member of crew) {
      await db
        .update(tripAssignments)
        .set({ tripRole: member.role === "divemaster" ? "captain" : "crew" })
        .where(
          and(eq(tripAssignments.tripId, reef.id), eq(tripAssignments.personId, member.personId)),
        );
    }
    return reef;
  }

  it("raises uncrewed_departure for a fun dive with divers booked and zero in-water crew", async () => {
    const { db, shop } = ctx;
    const reef = await uncrewedReefTrip(db, shop.id);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    const row = work.actions.find((action) => action.id === `uncrewed:${reef.id}`);
    expect(row?.kind).toBe("uncrewed_departure");
    // Divers only: the snorkeler and the rider aboard (`seed-mixed-boat.ts`)
    // are in the headcount, not the ratio.
    expect(reef.bookedDivers).toBeLessThan(reef.booked);
    expect(row?.detail).toBe(`${reef.bookedDivers} divers booked, no divemaster or instructor.`);
    // The boundary this ticket must not blur: instructor_missing is an
    // agency training ratio and only ever fires for a course session. This
    // trip carries no course.
    expect(work.actions.some((action) => action.id === `instructor:${reef.id}`)).toBe(false);
  });

  it("raises no crew row at all for a shop that keeps no crew schedule", async () => {
    // `shopCrewTarget` (src/lib/crew-schedule.ts) hands the queue a null
    // target when `shops.crew_schedule_enabled` is off: the same uncrewed reef
    // trip as above, and nothing about its crew.
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);

    const work = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      null,
    );

    const crewRows = work.actions.filter(
      (action) =>
        action.id === `uncrewed:${reef.id}` ||
        action.id === `crew-target:${reef.id}` ||
        action.id === `instructor:${reef.id}`,
    );
    expect(crewRows).toEqual([]);
  });

  it("raises the quieter crew_below_target once some crew is rostered, not uncrewed_departure", async () => {
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);
    const staff = await listStaff(db, shop.id);
    const divemaster = staff.find(
      (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
    );
    if (!divemaster) throw new Error("seeded fixture missing a divemaster");
    await setTripCrew(db, shop.id, reef.id, [
      { personId: divemaster.person.id, tripRole: "divemaster" },
    ]);

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(work.actions.some((action) => action.id === `uncrewed:${reef.id}`)).toBe(false);
    const row = work.actions.find((action) => action.id === `crew-target:${reef.id}`);
    expect(row?.kind).toBe("crew_below_target");
    expect(row?.detail).toBe(`${reef.bookedDivers} divers, 1 supervisor. Your target is 6:1.`);
  });

  it("clears both rows once the departure meets its own target", async () => {
    const { db, shop } = ctx;
    const reef = await reefTrip(db, shop.id);
    // The demo's own default divers-per-divemaster is 6, and this trip books
    // 9 — two divemasters clears ceil(9/6).
    const staff = await listStaff(db, shop.id);
    const inWaterQualified = staff.filter(
      (entry) => entry.roles.includes("divemaster") || entry.roles.includes("instructor"),
    );
    expect(inWaterQualified.length).toBeGreaterThanOrEqual(2);
    await setTripCrew(
      db,
      shop.id,
      reef.id,
      inWaterQualified
        .slice(0, 2)
        .map((entry) => ({ personId: entry.person.id, tripRole: "divemaster" as const })),
    );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${reef.id}` || action.id === `crew-target:${reef.id}`,
      ),
    ).toBe(false);
  });

  it("never raises either row for an empty boat", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Empty afternoon dive",
      startsAt: new Date(nowMs() + 26 * 60 * 60 * 1000),
      endsAt: new Date(nowMs() + 28 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create trip");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${trip.id}` || action.id === `crew-target:${trip.id}`,
      ),
    ).toBe(false);
  });

  /**
   * The crew-gap rows one departure raised, in the order Today ranked them.
   *
   * Three ids, because #732's rule is about these three and nothing else: a
   * departure legitimately carries `dive_prep`, waiver and payment rows beside
   * whichever of these fires.
   */
  function crewGapKindsFor(work: { actions: { id: string; kind: string }[] }, tripId: string) {
    const ids = [`instructor:${tripId}`, `uncrewed:${tripId}`, `crew-target:${tripId}`];
    return work.actions.filter((action) => ids.includes(action.id)).map((action) => action.kind);
  }

  /**
   * **One row per departure, and which one wins when both rules hold.**
   *
   * A course session with divers aboard and nobody in the water satisfies
   * `courseCrewGap` and `divemasterRatioGap` at once. Issue #732 established
   * that it gets one row, never two — two rows naming one gap in two
   * vocabularies is the wallpaper failure `KIND_SEVERITY`'s own comments
   * design against — and this fixture is the shape that produces it: an
   * instructor rostered, the session books out, and the instructor is then
   * reassigned to `crew`, which contributes nothing in the water
   * (`inWaterCrewRole`, src/lib/crew-roles.ts).
   *
   * The row it gets is `uncrewed_departure`, not `instructor_missing`, as of
   * issue #1338. #732's rule is about the *count*, and the count is unchanged;
   * what moved is that `instructor_missing`'s sentence mentions no divemaster,
   * so a manager reading it on an empty boat concludes one is already aboard
   * and only the instructor is outstanding. The bigger fact goes first, and
   * the Crew panel one tap away holds the detail.
   */
  it("places the one row that says both, for a course session with nobody in the water", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Instructor reassigned Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Rostered (no per-trip role, so shop-wide inference staffs it) before the
    // booking gate runs — the same shape as the DOM-M3 fixture above, and the
    // realistic way this scenario actually arises: a session books out while
    // staffed, and the instructor is reassigned to something else afterward
    // (the booking gate only checks at booking time, never continuously).
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Uncrewed Course Diver",
        email: "uncrewed-course-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    // Exactly one *crew-gap* row for this departure — #732's rule, asserted
    // over all three ids rather than as the absence of the two the old
    // assertion happened to name. Other kinds (`dive_prep` and friends) fire
    // for the same departure and are not what that rule is about.
    expect(crewGapKindsFor(work, trip.id)).toEqual(["uncrewed_course"]);

    // **The crew schedule switch never hides a course's instructor gap.** A
    // shop that keeps no roster (a null target, `shopCrewTarget`) loses the
    // divemaster half of the sentence and keeps the half the agency ratio
    // refuses seats on.
    const noRoster = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shop.timezone,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      null,
    );
    expect(crewGapKindsFor(noRoster, trip.id)).toEqual(["instructor_missing"]);
  });

  /**
   * The boundary the test above used to hold, restated where it is actually
   * about a boundary: a course session **with** somebody in the water and no
   * instructor. "No crew" is false here, so `instructor_missing` is both the
   * true row and the more precise one — it cites the agency ratio a seat is
   * refused against — and `crew_below_target` must still not fire beside it.
   */
  it("keeps the instructor row, and only it, once a divemaster is in the water", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!course || !instructor) throw new Error("seeded fixture missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Divemaster-only Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    // Same shape as the fixture above, one role apart: rostered before the
    // booking gate runs (which refuses a course session with no instructor —
    // `course_unstaffed`), then reassigned afterwards. `divemaster` rather
    // than `crew`, so the same person now counts as a certified assistant in
    // the water and the session is short an instructor without being empty
    // (`inWaterCrewRole`, src/lib/crew-roles.ts).
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Divemaster Only Diver",
        email: "divemaster-only-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "divemaster" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);

    expect(crewGapKindsFor(work, trip.id)).toEqual(["instructor_missing"]);
  });

  /**
   * **A shop whose ordinary product is an unguided buddy-pair dive can say so,
   * once, per departure** (issue #973).
   *
   * The row above is warning-toned and sits near the top of Today. Without a
   * way to mark a departure self-guided, a shop that runs self-guided charters
   * would see it on every sailing forever, with no way to silence it short of
   * rostering a divemaster it did not want — which is the habituation ADR
   * 20260820-shop-divemaster-ratio was written to avoid, arriving as "staff
   * learn to skip this row" rather than as a refusal.
   */
  it("raises neither row for a departure the shop marked self-guided", async () => {
    const { db, shop } = ctx;
    const reef = await uncrewedReefTrip(db, shop.id);
    // The same trip the first test in this block proves *does* raise the row,
    // so the only thing that changed is the mark.
    const before = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(before.actions.some((action) => action.id === `uncrewed:${reef.id}`)).toBe(true);

    await db.update(tripsTable).set({ selfGuided: true }).where(eq(tripsTable.id, reef.id));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(
      work.actions.some(
        (action) => action.id === `uncrewed:${reef.id}` || action.id === `crew-target:${reef.id}`,
      ),
    ).toBe(false);
  });

  /**
   * The boundary the mark must never cross. An agency training ratio is a
   * safety cap that really does refuse a seat (`src/lib/course-ratios.ts`), and
   * no shop may switch one off by ticking a box on the departure.
   */
  it("still flags a course session's missing instructor when the departure is self-guided", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    if (!course) throw new Error("seeded course missing");
    const startsAt = new Date(nowMs() + 3 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Self-guided marked Open Water session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    // Staffed at booking time, then reassigned — the same shape as the
    // double-fire test above, and the realistic way the gap actually arises.
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: instructor.person.id });
    const party = await createBookingParty(db, [
      {
        actor: "staff" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Self Guided Course Diver",
        email: "self-guided-course-diver@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(
          eq(tripAssignments.tripId, trip.id),
          eq(tripAssignments.personId, instructor.person.id),
        ),
      );
    await db.update(tripsTable).set({ selfGuided: true }).where(eq(tripsTable.id, trip.id));

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    expect(work.actions.some((action) => action.id === `instructor:${trip.id}`)).toBe(true);
  });
});
