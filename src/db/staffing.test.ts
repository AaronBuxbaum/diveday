import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { bookings, courses, people, staffShifts, tripAssignments } from "./schema";
import { createStaffShift, crewShiftCoverage, getStaffingView } from "./staffing";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";

/**
 * 180 days out, matching src/db/courses.test.ts's OPEN_TEST_SESSION_OFFSET_MS
 * reasoning: far enough past the seeded demo's instructor calendar (day 75)
 * that a synthetic session never collides with the seed's real crew overlaps.
 */
const OPEN_TEST_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * A seat on a departure, written straight to the row.
 *
 * `createBooking` is the door a *diver* comes through and enforces this shop's
 * readiness requirements on the way; every test here needs only the fact that
 * somebody is aboard, because that is the whole input the supervision target
 * takes ("a departure with nobody booked is never short",
 * src/lib/divemaster-ratio.ts).
 */
async function seatDiver(db: AppDb, shopId: string, tripId: string, tag: string): Promise<void> {
  const [diver] = await db
    .insert(people)
    .values({ shopId, fullName: `Aboard ${tag}`, email: `staffing-aboard-${tag}@example.com` })
    .returning();
  if (!diver) throw new Error("failed to insert diver");
  await db.insert(bookings).values({ shopId, tripId, personId: diver.id });
}

describe("staffing view", () => {
  it("shows roles, working windows, and the departures a person crews", async () => {
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
    expect(working?.roles).toContain("instructor");
    expect(working?.shifts).toHaveLength(1);
    // The shift and the boat, both against the one person: the week places
    // them in the same day cell, and a boat somebody crews with no shift
    // against it is exactly what that cross-link exists to show (task 165).
    expect(working?.crewingTrips.map((entry) => entry.tripId)).toContain(trip.id);
    expect(view.crewGaps.departures).toBeGreaterThanOrEqual(1);
  });

  /**
   * The gap list and the gap count are one walk (ADR
   * 20260827-the-shops-shelves, decision 3): the staffing week places each
   * short-handed departure in the day it sails, so the reader has to hand
   * back the departures it counted rather than only the tally. Two answers
   * from two passes could disagree; this pins that they cannot.
   */
  it("hands back the departures behind the count, in the count's own codes", async () => {
    const { db, shop } = await seededShopContext();
    const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
    const bare = await createTrip(db, {
      shopId: shop.id,
      title: "Uncrewed gap charter",
      startsAt,
      endsAt,
      capacity: 10,
      plannedDives: 2,
    });
    if (!bare) throw new Error("failed to create gap fixture");

    // A departure the shop still has to run, with divers on it and nobody in
    // the water: the state the gap row exists for.
    await seatDiver(db, shop.id, bare.id, "gap-charter");

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(startsAt.getTime() - 60 * 60 * 1000),
      new Date(endsAt.getTime() + 60 * 60 * 1000),
    );
    expect(view.gapTrips).toHaveLength(view.crewGaps.needCrew);
    expect(view.gapTrips).toContainEqual({
      tripId: bare.id,
      title: "Uncrewed gap charter",
      startsAt: bare.startsAt,
      gap: "uncrewed_departure",
      meetings: [{ startsAt: bare.startsAt, endsAt: bare.endsAt }],
    });
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
  // solo-instructor ratio, still needs crew — the old boolean
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
   * `createBooking`. Returns the roster's crew-gap summary for a window
   * holding that one session and nothing else.
   */
  async function overRatioSessionCrewGaps(courseTitle: string, withinRatio: number, tag: string) {
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
      startsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
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
    return view.crewGaps;
  }

  // A session already carrying an instructor but booked past its ratio still
  // needs crew. The roster no longer says *which* kind of gap it is — that
  // vocabulary belongs to Today, the surface that can fix it — but it must not
  // quietly drop the departure from the count either, which is what the
  // "has an instructor?" boolean this replaced would have done.
  it("counts a ratio-over-capacity session that already has an instructor as needing crew", async () => {
    // Open Water training dives: 8 through the gate, the 9th inserted directly.
    expect(await overRatioSessionCrewGaps("Open Water Diver", 8, "ow")).toEqual({
      departures: 1,
      needCrew: 1,
    });
  });

  it("counts an over-ratio intro (Discover Scuba) session at its far tighter 2:1 cap", async () => {
    // The same advisory at the Instructor Manual DSD ratio (DOM-H2, HD-6): 2
    // through the gate, the 3rd inserted directly. Under the old 8/12 numbers
    // this trip read as covered.
    expect(await overRatioSessionCrewGaps("Discover Scuba Diving", 2, "dsd")).toEqual({
      departures: 1,
      needCrew: 1,
    });
  });

  it("counts a crewed course session with no instructor as needing crew", async () => {
    // The other half of the same rule: zero instructors is the code that
    // actually means "find an instructor", and it must not be crowded out by
    // (or confused with) the ratio advisory. `setTripCrew` refuses to leave a
    // course session instructorless, so the assignment is inserted directly —
    // standing in for the states that reach it anyway (a data import, or a
    // crew member who has since lost their instructor role).
    const { db, shop } = await seededShopContext();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    if (!course) throw new Error("Open Water Diver course missing");
    const staff = await listStaff(db, shop.id);
    const deckhand = staff.find(
      (entry) => entry.roles.includes("captain") && !entry.roles.includes("instructor"),
    );
    if (!deckhand) throw new Error("seeded non-instructor crew missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Uninstructed session",
      startsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create uninstructed test trip");
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: deckhand.person.id });

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    expect(view.crewGaps).toEqual({ departures: 1, needCrew: 1 });
  });

  it("leaves an adequately crewed course session out of the count", async () => {
    // The count rises only when `courseCrewGap` reports something other than
    // "none". One instructor, one seat.
    const { db, shop } = await seededShopContext();
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
    if (!course) throw new Error("Open Water Diver course missing");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Within-ratio session",
      startsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS),
      endsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create within-ratio test trip");
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Within Ratio Diver",
      email: "staffing-within-ratio-diver@example.com",
    });
    expect(booking).toMatchObject({ ok: true });
    const shift = await createStaffShift(db, {
      shopId: shop.id,
      personId: instructor.person.id,
      startsAt: new Date(trip.startsAt.getTime() - 30 * 60 * 1000),
      endsAt: new Date(trip.endsAt.getTime() + 30 * 60 * 1000),
    });
    expect(shift.ok).toBe(true);

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
      new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
    );
    expect(view.crewGaps).toEqual({ departures: 1, needCrew: 0 });
  });

  /**
   * The one this surface got backwards, and the dangerous direction.
   *
   * "Does this departure have a `trip_assignments` row" is not the question a
   * manager planning the weekend is asking. A twelve-diver reef charter with a
   * captain rostered and no divemaster has a row and nobody in the water — it
   * raises `uncrewed_departure` on Today, and it used to draw a clean, empty
   * day cell here. The same walk now runs `divemasterRatioGap`, the one module
   * that judgement lives in "so the trip page, the Today queue and whatever
   * reads this next must not be able to disagree".
   */
  it("counts a captain-only charter with divers aboard as uncrewed", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    // Rostered as this trip's captain, so what else they hold in the shop is
    // beside the point: a captain is driving the boat, not supervising anybody
    // in the water (`inWaterCrewRole`, src/lib/crew-roles.ts).
    const captain = staff.find((entry) => entry.roles.includes("captain"));
    const divemaster = staff.find(
      (entry) => entry.roles.includes("divemaster") && entry.person.id !== captain?.person.id,
    );
    if (!captain || !divemaster) throw new Error("seeded crew missing");
    const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Captain-only reef charter",
      startsAt,
      endsAt,
      capacity: 12,
      plannedDives: 2,
    });
    if (!charter) throw new Error("failed to create charter fixture");
    expect(
      await setTripCrew(db, shop.id, charter.id, [
        { personId: captain.person.id, tripRole: "captain" },
      ]),
    ).toBe(true);
    await seatDiver(db, shop.id, charter.id, "captain-only");

    const readWeek = async () =>
      getStaffingView(
        db,
        shop.id,
        new Date(startsAt.getTime() - HOUR_MS),
        new Date(endsAt.getTime() + HOUR_MS),
      );
    expect((await readWeek()).gapTrips.map((gap) => gap.gap)).toEqual(["uncrewed_departure"]);

    // A divemaster in the water clears it. Nothing about the row count moved.
    expect(
      await setTripCrew(db, shop.id, charter.id, [
        { personId: captain.person.id, tripRole: "captain" },
        { personId: divemaster.person.id, tripRole: "divemaster" },
      ]),
    ).toBe(true);
    expect((await readWeek()).gapTrips).toEqual([]);
  });

  /**
   * **Which of two true facts a course session shows when both hold.**
   *
   * A course session with nobody in the water satisfies `courseCrewGap` (no
   * instructor) and `divemasterRatioGap` (nobody supervising) at once. Issue
   * #732 settled that a departure carries one row for one underlying fact, and
   * the course gap won outright — so an empty boat read "Course needs
   * instructor", which a manager takes to mean a divemaster is already on it
   * and only the instructor is outstanding. Since issue #1125 shortened the
   * chip to those three words there is no sentence beside it to correct the
   * inference. Issue #1338.
   *
   * #732's rule survives: still exactly one row, still never both.
   */
  describe("a course session with nobody in the water", () => {
    /** A course session on `Open Water Diver`, crewed by the given people. */
    async function courseSession(
      db: AppDb,
      shopId: string,
      title: string,
      crew: { personId: string; tripRole: "captain" | "divemaster" | "instructor" }[],
    ) {
      const [course] = await db
        .select()
        .from(courses)
        .where(and(eq(courses.shopId, shopId), eq(courses.title, "Open Water Diver")));
      if (!course) throw new Error("Open Water Diver course missing");
      const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
      const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
      const trip = await createTrip(db, {
        shopId,
        courseId: course.id,
        title,
        startsAt,
        endsAt,
        capacity: 12,
        plannedDives: 2,
      });
      if (!trip) throw new Error(`failed to create ${title}`);
      // Written straight to the row: `setTripCrew` refuses to leave a course
      // session instructorless, and an instructorless session is the whole
      // subject here. These states arrive anyway — a data import, or a crew
      // member who has since lost their instructor role.
      if (crew.length > 0)
        await db.insert(tripAssignments).values(
          crew.map((entry) => ({
            tripId: trip.id,
            personId: entry.personId,
            tripRole: entry.tripRole,
          })),
        );
      const readWeek = async () =>
        getStaffingView(
          db,
          shopId,
          new Date(startsAt.getTime() - HOUR_MS),
          new Date(endsAt.getTime() + HOUR_MS),
        );
      return { trip, readWeek };
    }

    it("says the bigger fact — nobody aboard, not a missing instructor", async () => {
      const { db, shop } = await seededShopContext();
      const staff = await listStaff(db, shop.id);
      const captain = staff.find((entry) => entry.roles.includes("captain"));
      if (!captain) throw new Error("seeded captain missing");
      // A captain is driving the boat, not supervising anybody in the water
      // (`inWaterCrewRole`, src/lib/crew-roles.ts), so this is a session with a
      // crew row and nobody in the water — the state that reads most
      // convincingly as "a divemaster is already on it".
      const { trip, readWeek } = await courseSession(db, shop.id, "Empty session", [
        { personId: captain.person.id, tripRole: "captain" },
      ]);
      await seatDiver(db, shop.id, trip.id, "empty-session");

      const view = await readWeek();
      expect(view.gapTrips.map((gap) => gap.gap)).toEqual(["uncrewed_departure"]);
      // #732's rule, restated where it could regress: the fix places a
      // different code, never a second row.
      expect(view.crewGaps).toEqual({ departures: 1, needCrew: 1 });
    });

    it("still names the instructor gap once somebody is in the water", async () => {
      // The half that must not move. A divemaster aboard makes "No crew"
      // false, and the instructor is then genuinely the one thing outstanding.
      const { db, shop } = await seededShopContext();
      const staff = await listStaff(db, shop.id);
      const divemaster = staff.find(
        (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
      );
      if (!divemaster) throw new Error("seeded divemaster missing");
      const { trip, readWeek } = await courseSession(db, shop.id, "Divemaster-only session", [
        { personId: divemaster.person.id, tripRole: "divemaster" },
      ]);
      await seatDiver(db, shop.id, trip.id, "dm-only-session");

      expect((await readWeek()).gapTrips.map((gap) => gap.gap)).toEqual(["no_instructor"]);
    });

    it("still names the instructor gap when there is nobody to supervise", async () => {
      // The exemption that makes `divemasterRatioGap` the right judge rather
      // than a bare zero-crew count. An unbooked session has nobody in the
      // water *and* nobody who needs supervising, so "No crew" would be noise
      // — while "Course needs instructor" stays true and stays actionable,
      // since a session without one cannot take an enrolment however empty it
      // is.
      const { db, shop } = await seededShopContext();
      const { readWeek } = await courseSession(db, shop.id, "Unbooked session", []);

      expect((await readWeek()).gapTrips.map((gap) => gap.gap)).toEqual(["no_instructor"]);
    });
  });

  /**
   * The quieter half of the same measurement: rostered, but under the shop's
   * own target. Today ranks this with the advisory rows and words it "Under
   * target"; the week has to say the same thing rather than either shouting or
   * staying silent.
   */
  it("counts a departure rostered under the shop's own target, in Today's quieter code", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const divemaster = staff.find((entry) => entry.roles.includes("divemaster"));
    if (!divemaster) throw new Error("seeded divemaster missing");
    const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const charter = await createTrip(db, {
      shopId: shop.id,
      title: "Under-target reef charter",
      startsAt,
      endsAt,
      capacity: 12,
      plannedDives: 2,
    });
    if (!charter) throw new Error("failed to create charter fixture");
    expect(
      await setTripCrew(db, shop.id, charter.id, [
        { personId: divemaster.person.id, tripRole: "divemaster" },
      ]),
    ).toBe(true);
    for (let i = 0; i < 4; i++) await seatDiver(db, shop.id, charter.id, `under-target-${i}`);

    // A tighter target than the default, deliberately: four divers want one
    // divemaster at the shop-wide default of six and two at three, so this
    // fails if the page's `shops.divers_per_divemaster` never reaches the walk.
    const view = await getStaffingView(
      db,
      shop.id,
      new Date(startsAt.getTime() - HOUR_MS),
      new Date(endsAt.getTime() + HOUR_MS),
      { diversPerDivemaster: 3 },
    );
    expect(view.gapTrips.map((gap) => gap.gap)).toEqual(["crew_below_target"]);

    // At the shop-wide default the same boat is adequately crewed — the target
    // is the shop's, not a number this module invented.
    const atDefault = await getStaffingView(
      db,
      shop.id,
      new Date(startsAt.getTime() - HOUR_MS),
      new Date(endsAt.getTime() + HOUR_MS),
    );
    expect(atDefault.gapTrips).toEqual([]);
  });

  /**
   * Three departures nobody has to crew, each of which used to draw a warning
   * chip with a live "Assign" link: an empty boat, a self-guided one, and one
   * that came home. Every one of them is the expected state formatted as an
   * alert — the failure `crewShiftCoverage` two functions below already exists
   * to prevent — and together they burn the only warning channel this surface
   * has.
   */
  it("says nothing about an empty, a self-guided, or an already-sailed departure", async () => {
    const { db, shop } = await seededShopContext();
    const startsAt = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    const empty = await createTrip(db, {
      shopId: shop.id,
      title: "Nobody booked yet",
      startsAt,
      endsAt,
      capacity: 10,
      plannedDives: 2,
    });
    const selfGuided = await createTrip(db, {
      shopId: shop.id,
      title: "Self-guided shore entry",
      startsAt,
      endsAt,
      capacity: 10,
      plannedDives: 2,
      selfGuided: true,
    });
    if (!empty || !selfGuided) throw new Error("failed to create charter fixtures");
    await seatDiver(db, shop.id, selfGuided.id, "self-guided");

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(startsAt.getTime() - HOUR_MS),
      new Date(endsAt.getTime() + HOUR_MS),
    );
    // Both are in the denominator — they are departures — and neither is work.
    expect(view.crewGaps).toEqual({ departures: 2, needCrew: 0 });

    // And the boat that came home. `trip_status` is only `scheduled`/
    // `cancelled`, so Monday's sailing is still `scheduled` on Friday and the
    // week deliberately shows up to six days behind: without the buffer, the
    // loudest thing on the page asks a manager to crew a boat back three days.
    const sailedStart = new Date(nowMs() - 2 * DAY_MS);
    const sailedEnd = new Date(sailedStart.getTime() + 4 * HOUR_MS);
    const sailed = await createTrip(db, {
      shopId: shop.id,
      title: "Home since Tuesday",
      startsAt: sailedStart,
      endsAt: sailedEnd,
      capacity: 10,
      plannedDives: 2,
    });
    if (!sailed) throw new Error("failed to create sailed fixture");
    await seatDiver(db, shop.id, sailed.id, "sailed");

    // By trip id rather than by count: the seeded shop has a past of its own,
    // and this window reaches back into it.
    const past = await getStaffingView(
      db,
      shop.id,
      new Date(sailedStart.getTime() - HOUR_MS),
      new Date(sailedEnd.getTime() + HOUR_MS),
    );
    expect(past.gapTrips.map((gap) => gap.tripId)).not.toContain(sailed.id);

    // The same departure, read half an hour after its scheduled return, is
    // still work — the late-arrival buffer every "has it sailed" question in
    // this repo carries, because trips run late.
    const stillOut = await getStaffingView(
      db,
      shop.id,
      new Date(sailedStart.getTime() - HOUR_MS),
      new Date(sailedEnd.getTime() + HOUR_MS),
      { now: new Date(sailedEnd.getTime() + 30 * 60 * 1000) },
    );
    expect(stillOut.gapTrips.find((gap) => gap.tripId === sailed.id)?.gap).toBe(
      "uncrewed_departure",
    );
  });

  /**
   * A multi-day course is a run, not a point. `trips.starts_at`/`ends_at`
   * bound the whole of it, so the week needs the meeting windows to know which
   * days an instructor is committed to — without them a Thursday-to-Saturday
   * class shows busy on Thursday and free for the two days it is being taught.
   */
  it("hands back a multi-day departure's meeting windows, not just its run", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const day1 = new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS);
    const day2 = new Date(day1.getTime() + DAY_MS);
    const run = await createTrip(db, {
      shopId: shop.id,
      title: "Two-evening specialty",
      startsAt: day1,
      endsAt: new Date(day2.getTime() + 4 * HOUR_MS),
      capacity: 6,
      plannedDives: 3,
      scheduleDays: [
        { dayNumber: 1, startsAt: day1, endsAt: new Date(day1.getTime() + 4 * HOUR_MS) },
        { dayNumber: 2, startsAt: day2, endsAt: new Date(day2.getTime() + 4 * HOUR_MS) },
      ],
    });
    if (!run) throw new Error("failed to create multi-day fixture");
    expect(await setTripCrew(db, shop.id, run.id, [instructor.person.id])).toBe(true);

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(day1.getTime() - HOUR_MS),
      new Date(day2.getTime() + 5 * HOUR_MS),
    );
    const crewing = view.staff
      .find((entry) => entry.person.id === instructor.person.id)
      ?.crewingTrips.find((trip) => trip.tripId === run.id);
    expect(crewing?.meetings.map((meeting) => meeting.startsAt)).toEqual([day1, day2]);
  });

  /**
   * DOM-M3. The roster's summary, the trip page, the Today queue, and the
   * booking gate all ask "is this course session staffed" and all used to
   * answer it from shop-wide roles alone, so an instructor rostered as this
   * trip's deck hand cleared the gap on his own. One definition now decides it
   * (`countInWaterCrew`, src/lib/crew-roles.ts) — and because the roster's
   * count is composed from Today's own reader, it cannot drift from Today
   * again.
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
      startsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 2 * 60 * 60 * 1000),
      endsAt: new Date(nowMs() + OPEN_TEST_SESSION_OFFSET_MS + 6 * 60 * 60 * 1000),
      capacity: 10,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create course trip");

    const needCrewFor = async () => {
      const view = await getStaffingView(
        db,
        shop.id,
        new Date(trip.startsAt.getTime() - 60 * 60 * 1000),
        new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
      );
      return view.crewGaps.needCrew;
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
    expect(await needCrewFor()).toBe(1);

    // The same person, rostered to the job he is actually doing.
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        { personId: instructor.person.id, tripRole: "instructor" },
      ]),
    ).toBe(true);
    expect(await needCrewFor()).toBe(0);

    // And an unspecified role stays the status quo.
    expect(await setTripCrew(db, shop.id, trip.id, [instructor.person.id])).toBe(true);
    expect(await needCrewFor()).toBe(0);
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
    expect(covered?.has(onShift.person.id)).toBe(true);
    expect(covered?.has(offShift.person.id)).toBe(false);
  });

  it("returns an empty set for no crew at a shop that schedules shifts", async () => {
    // The seeded fixture already carries staff shifts, so this shop "uses
    // shifts" — an empty crew list is then an empty answer, never null.
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded upcoming trip missing");
    expect(await crewShiftCoverage(db, shop.id, trip, [])).toEqual(new Set());
  });

  it("answers null for a shop that has never scheduled a shift — the question does not apply", async () => {
    // The regression this pins: a shop that doesn't use the staffing feature
    // used to get a "Not on a shift" warning on every crew member of every
    // trip, forever — the expected state formatted as an alert (design
    // principle 9). No shifts on file means shift coverage is not a question
    // this shop asks, which is a different answer from "nobody is covered".
    const { db, shop } = await seededShopContext();
    await db.delete(staffShifts).where(eq(staffShifts.shopId, shop.id));
    const staff = await listStaff(db, shop.id);
    const [crew] = staff;
    if (!crew) throw new Error("seeded staffing fixture needs staff");
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded upcoming trip missing");
    expect(await crewShiftCoverage(db, shop.id, trip, [crew.person.id])).toBeNull();
    expect(await crewShiftCoverage(db, shop.id, trip, [])).toBeNull();
  });
});
