import { and, count, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { getTripManifest, recordCrewRollCall } from "./manifests";
import type { Course } from "./schema";
import { bookings, courses, people, personRoles, shops } from "./schema";
import { setStaffLanguages } from "./staff-accounts";
import {
  changeTripCrew,
  createTrip,
  deleteTrip,
  getTripCrewAssignments,
  getTripCrewIds,
  getTripRoster,
  listStaff,
  listTripScheduleDays,
  listTripSpokenLanguages,
  setTripCrew,
  upcomingStaffSchedule,
  upcomingTripsWithCounts,
} from "./trips";

const FOREIGN_SHOP_ID = "00000000-0000-4000-8000-000000000099";

/** `{ personId, tripRole }` as a Map entry, so a role assertion reads as one object. */
const byPerson = (row: { personId: string; tripRole: string | null }) =>
  [row.personId, row.tripRole] as const;

describe("trip crew (CR-007: cross-tenant write path)", () => {
  it("stores variable meeting windows and rejects crew overlap on any course day", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const first = await createTrip(db, {
      shopId: shop.id,
      title: "Open Water test class",
      startsAt: new Date("2030-08-01T12:00:00Z"),
      endsAt: new Date("2030-08-02T18:00:00Z"),
      capacity: 4,
      scheduleDays: [
        {
          dayNumber: 1,
          startsAt: new Date("2030-08-01T12:00:00Z"),
          endsAt: new Date("2030-08-01T16:00:00Z"),
        },
        {
          dayNumber: 2,
          startsAt: new Date("2030-08-02T12:00:00Z"),
          endsAt: new Date("2030-08-02T18:00:00Z"),
        },
      ],
    });
    if (!first) throw new Error("first multi-day trip not created");
    expect(await listTripScheduleDays(db, shop.id, first.id)).toHaveLength(2);
    expect(await setTripCrew(db, shop.id, first.id, [instructor.person.id])).toBe(true);
    const board = await upcomingStaffSchedule(
      db,
      shop.id,
      new Date("2030-08-01T00:00:00Z"),
      new Date("2030-09-01T00:00:00Z"),
      new Date("2030-07-01T00:00:00Z"),
    );
    expect(board.find((trip) => trip.id === first.id)).toMatchObject({
      days: [
        { dayNumber: 1, startsAt: new Date("2030-08-01T12:00:00Z") },
        { dayNumber: 2, startsAt: new Date("2030-08-02T12:00:00Z") },
      ],
      crew: [{ id: instructor.person.id, name: instructor.person.fullName }],
    });
    const second = await createTrip(db, {
      shopId: shop.id,
      title: "Day-two overlap",
      startsAt: new Date("2030-08-02T15:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 4,
    });
    if (!second) throw new Error("second trip not created");
    expect(await setTripCrew(db, shop.id, second.id, [instructor.person.id])).toBe(false);
  });

  it("assigns and replaces the crew, keeping only staff of this shop", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const staff = await listStaff(db, shop.id);
    if (staff.length < 2) throw new Error("expected at least two seeded staff");

    const [first, second] = staff;
    if (!first || !second) throw new Error("expected two staff rows");
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        first.person.id,
        second.person.id,
        crypto.randomUUID(), // not a real person — silently dropped, not an error
      ]),
    ).toBe(true);
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(
      new Set([first.person.id, second.person.id]),
    );

    // Replacing with a smaller set actually removes the dropped assignment.
    expect(await setTripCrew(db, shop.id, trip.id, [first.person.id])).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([first.person.id]);
  });
  it("changes one crew member without replacing other assignments", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("expected two seeded staff");

    expect(await setTripCrew(db, shop.id, trip.id, [first.person.id])).toBe(true);
    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: second.person.id,
        operation: "assign",
      }),
    ).toBe(true);
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(
      new Set([first.person.id, second.person.id]),
    );

    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: first.person.id,
        operation: "unassign",
      }),
    ).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([second.person.id]);
  });

  /**
   * DOM-M3 (ADR 20260803-per-trip-crew-role). `setTripCrew` is
   * delete-all-then-insert and `changeTripCrew` inserted with
   * `onConflictDoNothing`, so the per-trip role had two ways to be silently
   * lost the moment it was added: any full crew edit would blank it, and a role
   * change on somebody already assigned would be accepted and ignored. Both are
   * safety bugs — the role is what keeps a rostered captain out of the
   * supervision ratio.
   */
  describe("per-trip crew roles survive both write paths", () => {
    async function context() {
      const { db, shop } = await seededShopContext();
      const trips = await upcomingTripsWithCounts(db, shop.id);
      const trip = trips[0];
      if (!trip) throw new Error("expected a seeded trip");
      const staff = await listStaff(db, shop.id);
      const [first, second] = staff;
      if (!first || !second) throw new Error("expected two seeded staff");
      return { db, shop, trip, first: first.person, second: second.person };
    }

    it("round-trips a role through setTripCrew instead of wiping it", async () => {
      const { db, shop, trip, first, second } = await context();
      expect(
        await setTripCrew(db, shop.id, trip.id, [
          { personId: first.id, tripRole: "captain" },
          { personId: second.id, tripRole: "divemaster" },
        ]),
      ).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([
          [first.id, "captain"],
          [second.id, "divemaster"],
        ]),
      );

      // A later full crew edit that says nothing about roles — the ordinary
      // "who is on this boat" edit — must not blank them.
      expect(await setTripCrew(db, shop.id, trip.id, [first.id, second.id])).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([
          [first.id, "captain"],
          [second.id, "divemaster"],
        ]),
      );

      // And an explicit null is how a role is actually cleared.
      expect(
        await setTripCrew(db, shop.id, trip.id, [
          { personId: first.id, tripRole: null },
          second.id,
        ]),
      ).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([
          [first.id, null],
          [second.id, "divemaster"],
        ]),
      );
    });

    it("updates a role on an existing assignment instead of ignoring the change", async () => {
      const { db, shop, trip, first } = await context();
      expect(
        await setTripCrew(db, shop.id, trip.id, [{ personId: first.id, tripRole: "divemaster" }]),
      ).toBe(true);

      // Already assigned: this is the `onConflict` path, and it used to accept
      // the call, return true, and keep the old role.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: first.id,
          operation: "assign",
          tripRole: "captain",
        }),
      ).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([[first.id, "captain"]]),
      );

      // Omitting the role still means "leave it alone" — assign stays idempotent.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: first.id,
          operation: "assign",
        }),
      ).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([[first.id, "captain"]]),
      );
    });

    /**
     * Review 20260803, D3. `changeTripCrew`'s unassign deleted the
     * `trip_assignments` row with no check for roll-call history:
     * `listTripCrew` then dropped the person, the assigned count fell, and a
     * checkpoint that was open **because a named crew member had been recorded
     * as not back aboard** flipped to complete — with their event rows still
     * sitting in `roll_call_crew_events`, read by nothing. One tap made a
     * stated "did not come back" disappear. Divers have had the analogous
     * guard from the start (`deleteTrip` refuses `already_sailed`).
     */
    it("refuses to take a crew member with roll-call history off the trip", async () => {
      const { db, shop, trip, first, second } = await context();
      expect(await setTripCrew(db, shop.id, trip.id, [first.id, second.id])).toBe(true);
      // She went back down for a lost weight belt and has not surfaced.
      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          personId: first.id,
          recordedByPersonId: second.id,
          status: "not_boarded",
          checkpoint: "after_dive_1",
        }),
      ).resolves.toMatchObject({ ok: true });

      // Both write paths refuse, and she stays on the crew list.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: first.id,
          operation: "unassign",
        }),
      ).toBe(false);
      expect(await setTripCrew(db, shop.id, trip.id, [second.id])).toBe(false);
      expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(
        new Set([first.id, second.id]),
      );
      // The checkpoint she is missing from is still open, which is the whole
      // point of refusing.
      const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
      expect(manifest?.completeness).toMatchObject({
        complete: false,
        crewReason: "crew_not_back_aboard",
      });

      // Somebody with no roll-call history on this trip is still removable.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: second.id,
          operation: "unassign",
        }),
      ).toBe(true);
      expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([first.id]);
    });

    /**
     * Review 20260803, D3, the related half. `deleteTrip` counted only
     * `rollCallEvents`, so a **bookingless** trip that carried crew — a charter
     * with a divemaster and no paying divers, or one whose only head count was
     * of its crew — walked straight past the "already sailed" guard and deleted
     * into a foreign-key violation instead of refusing cleanly.
     */
    it("refuses to delete a bookingless trip that carries crew head-count evidence", async () => {
      const { db, shop, first, second } = await context();
      const bare = await createTrip(db, {
        shopId: shop.id,
        title: "Crew-only charter",
        startsAt: new Date(nowDate().getTime() + 300 * 24 * 60 * 60 * 1000),
        endsAt: new Date(nowDate().getTime() + 300 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
        capacity: 8,
        plannedDives: 1,
      });
      if (!bare) throw new Error("failed to create trip");
      // Nothing has happened yet, so it is still an ordinary board mistake.
      expect(await setTripCrew(db, shop.id, bare.id, [first.id, second.id])).toBe(true);

      await expect(
        recordCrewRollCall(db, {
          shopId: shop.id,
          tripId: bare.id,
          personId: first.id,
          recordedByPersonId: second.id,
          status: "boarded",
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(await deleteTrip(db, shop.id, bare.id)).toEqual({
        ok: false,
        reason: "already_sailed",
      });

      // A departure nobody has touched still deletes, which is what the guard
      // is for in the first place.
      const untouched = await createTrip(db, {
        shopId: shop.id,
        title: "Board mistake",
        startsAt: new Date(nowDate().getTime() + 320 * 24 * 60 * 60 * 1000),
        endsAt: new Date(nowDate().getTime() + 320 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
        capacity: 8,
        plannedDives: 1,
      });
      if (!untouched) throw new Error("failed to create trip");
      expect(await deleteTrip(db, shop.id, untouched.id)).toEqual({ ok: true });
    });

    /**
     * Review 20260803, D4. Unassign-then-reassign — the CrewSection flow, and
     * how staff fix a mis-tap — deletes the row and its role with it, and a
     * re-assign that names no role lands `null`. The captain silently becomes
     * an in-water certified assistant again and the seat cap rises by two.
     * That is why the role has to be settable in the UI: this asserts the
     * losing behaviour plainly, and that naming the role restores it.
     */
    it("loses the role on unassign, and takes it back the moment a caller names one", async () => {
      const { db, shop, trip, first } = await context();
      expect(
        await setTripCrew(db, shop.id, trip.id, [{ personId: first.id, tripRole: "captain" }]),
      ).toBe(true);
      expect(
        await changeTripCrew(db, shop.id, trip.id, { personId: first.id, operation: "unassign" }),
      ).toBe(true);
      expect(
        await changeTripCrew(db, shop.id, trip.id, { personId: first.id, operation: "assign" }),
      ).toBe(true);
      // The row and its role went together: this is "nobody has said", which is
      // the status quo, and it counts by shop-wide inference again.
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([[first.id, null]]),
      );
      // The trip's crew section ships a role picker that posts exactly this.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: first.id,
          operation: "assign",
          tripRole: "captain",
        }),
      ).toBe(true);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([[first.id, "captain"]]),
      );
    });

    it("scopes both reads and writes to the owning shop", async () => {
      const { db, shop, trip, first } = await context();
      await setTripCrew(db, shop.id, trip.id, [{ personId: first.id, tripRole: "captain" }]);
      // `trip_assignments` carries no shop_id (CR-007): the read proves tenancy
      // through the trip, so another shop sees nothing at all here.
      expect(await getTripCrewAssignments(db, FOREIGN_SHOP_ID, trip.id)).toEqual([]);
      expect(
        await changeTripCrew(db, FOREIGN_SHOP_ID, trip.id, {
          personId: first.id,
          operation: "assign",
          tripRole: "crew",
        }),
      ).toBe(false);
      expect(new Map((await getTripCrewAssignments(db, shop.id, trip.id)).map(byPerson))).toEqual(
        new Map([[first.id, "captain"]]),
      );
    });
  });

  /**
   * A crew change is a record of who is actually aboard, and a boat that sails
   * a crew member short is exactly when that record matters most (DOM-H2). The
   * ratio gap it opens is loud (`over_ratio`) and blocks the *next* booking, but
   * it never blocks writing down reality — refusing left the sick instructor on
   * the printed manifest.
   *
   * 180 days out keeps the synthetic session clear of the seeded instructor
   * calendar, as in `src/db/courses.test.ts`.
   */
  const CREW_TEST_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

  async function twoInstructorIntroSession(db: AppDb, shopId: string) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shopId), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("Discover Scuba Diving course missing");
    const staff = await listStaff(db, shopId);
    const seededInstructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!seededInstructor) throw new Error("seeded instructor missing");
    // The seed carries one instructor; this session needs two so the ratio has
    // somewhere to fall from when one of them calls in sick.
    const [second] = await db
      .insert(people)
      .values({ shopId, fullName: "Ana Silva", email: "ana-silva@example.com" })
      .returning();
    if (!second) throw new Error("failed to insert second instructor");
    await db.insert(personRoles).values({ personId: second.id, role: "instructor" });

    const trip = await createTrip(db, {
      shopId,
      courseId: course.id,
      title: "Discover Scuba — crew change test",
      startsAt: new Date(nowMs() + CREW_TEST_OFFSET_MS),
      endsAt: new Date(nowMs() + CREW_TEST_OFFSET_MS + 4 * 60 * 60 * 1000),
      // Well above the 4 seats two instructors support at 2:1, so only the
      // ratio is ever in play.
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create crew change test trip");
    if (!(await setTripCrew(db, shopId, trip.id, [seededInstructor.person.id, second.id]))) {
      throw new Error("failed to assign two instructors");
    }
    // Four divers: legal at 2:1 with two instructors, over ratio with one.
    for (let i = 0; i < 4; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId,
        tripId: trip.id,
        fullName: `Crew Change Diver ${i}`,
        email: `crew-change-diver-${i}@example.com`,
      });
      if (!outcome.ok) throw new Error("setup booking failed");
    }
    return { trip, course, staying: seededInstructor.person.id, leaving: second.id };
  }

  /** The gap the trip page, the staffing list, and Today all read. */
  async function crewGapFor(db: AppDb, shopId: string, tripId: string, course: Course) {
    const crewIds = await getTripCrewIds(db, shopId, tripId);
    const staff = await listStaff(db, shopId);
    const assigned = staff.filter((entry) => crewIds.includes(entry.person.id));
    const [row] = await db
      .select({ booked: count() })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
    return courseCrewGap({
      course,
      instructorCount: assigned.filter((entry) => entry.roles.includes("instructor")).length,
      assistantCount: assigned.filter(
        (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
      ).length,
      booked: row?.booked ?? 0,
    });
  }

  it("records a crew change that leaves a session over ratio, and raises over_ratio", async () => {
    const { db, shop } = await seededShopContext();
    const { trip, course, staying, leaving } = await twoInstructorIntroSession(db, shop.id);

    // 6:45am, one of the two instructors calls in sick. The change is recorded.
    expect(
      await changeTripCrew(db, shop.id, trip.id, { personId: leaving, operation: "unassign" }),
    ).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([staying]);

    // Loudly, not silently: the same gap the trip page and Today surface.
    expect(await crewGapFor(db, shop.id, trip.id, course)).toEqual({
      code: "over_ratio",
      booked: 4,
      capacity: 2,
      ratio: "intro",
    });

    // And the seats already sold are still refused a fifth — the booking gate
    // is where the ratio blocks, and it reads the tightened crew.
    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Crew Change Diver 4",
        email: "crew-change-diver-4@example.com",
      }),
    ).resolves.toEqual({ ok: false, reason: "course_ratio_full" });
  });

  it("records the same reduction through a whole-crew replace", async () => {
    const { db, shop } = await seededShopContext();
    const { trip, course, staying } = await twoInstructorIntroSession(db, shop.id);

    expect(await setTripCrew(db, shop.id, trip.id, [staying])).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([staying]);
    expect(await crewGapFor(db, shop.id, trip.id, course)).toEqual({
      code: "over_ratio",
      booked: 4,
      capacity: 2,
      ratio: "intro",
    });
  });

  it("still refuses a crew change that would leave a course session with no instructor", async () => {
    const { db, shop } = await seededShopContext();
    const { trip, staying, leaving } = await twoInstructorIntroSession(db, shop.id);
    expect(
      await changeTripCrew(db, shop.id, trip.id, { personId: leaving, operation: "unassign" }),
    ).toBe(true);
    // Unstaffing the session entirely is a different rule and still blocks: a
    // course session with nobody qualified to teach it cannot be a recorded
    // state, and it is `setTripStatus`/cancellation, not a crew edit, that
    // takes a session off the water.
    expect(
      await changeTripCrew(db, shop.id, trip.id, { personId: staying, operation: "unassign" }),
    ).toBe(false);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([staying]);
  });

  it("refuses to write or read crew for a trip id that isn't this shop's", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const [staffMember, otherStaffMember] = await listStaff(db, shop.id);
    if (!staffMember || !otherStaffMember) throw new Error("expected two seeded staff");
    // Some seeded trips already carry crew (e.g. an instructor); capture
    // whatever this trip starts with so the refusal can be proven by
    // "unchanged", not by assuming an empty starting state.
    const before = new Set(await getTripCrewIds(db, shop.id, trip.id));

    // A tripId that is real, but for a different shop, must not let that
    // shop's staff list get written onto it.
    expect(await setTripCrew(db, FOREIGN_SHOP_ID, trip.id, [otherStaffMember.person.id])).toBe(
      false,
    );
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(before);

    // Nor does asking for the crew under the wrong shop leak the real one.
    await setTripCrew(db, shop.id, trip.id, [staffMember.person.id]);
    expect(await getTripCrewIds(db, FOREIGN_SHOP_ID, trip.id)).toEqual([]);
  });

  it("does not leak a trip's roster to a genuinely different shop (CR-007)", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-roster-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((t) => t.booked > 0);
    if (!trip) throw new Error("expected a seeded trip with at least one booking");

    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(roster.length).toBeGreaterThan(0);

    // A real second shop, asking about shop's real, booked trip — not a
    // hardcoded placeholder id — sees nothing.
    expect(await getTripRoster(db, otherShop.id, trip.id)).toEqual([]);
  });
});

describe("listTripSpokenLanguages (issue #970 — the per-trip half of #708)", () => {
  it("returns the union of the trip's currently assigned crew's languages, deduplicated", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("seeded shop needs at least two staff members");
    await setStaffLanguages(db, {
      shopId: shop.id,
      personId: first.person.id,
      languages: ["de", "fr"],
    });
    await setStaffLanguages(db, {
      shopId: shop.id,
      personId: second.person.id,
      languages: ["fr", "ja"],
    });
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    await setTripCrew(db, shop.id, trip.id, [first.person.id, second.person.id]);

    expect([...(await listTripSpokenLanguages(db, shop.id, trip.id))].sort()).toEqual([
      "de",
      "fr",
      "ja",
    ]);
  });

  it("says nothing for a crew member's language once they're no longer assigned to the trip", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("seeded shop needs at least two staff members");
    await setStaffLanguages(db, { shopId: shop.id, personId: first.person.id, languages: ["de"] });
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    await setTripCrew(db, shop.id, trip.id, [first.person.id]);
    expect(await listTripSpokenLanguages(db, shop.id, trip.id)).toEqual(["de"]);

    // Reassigned off the boat — not this sailing's crew any more, so not this
    // sailing's languages either. `setTripCrew` replaces the whole roster.
    await setTripCrew(db, shop.id, trip.id, [second.person.id]);
    expect(await listTripSpokenLanguages(db, shop.id, trip.id)).toEqual([]);
  });

  it("returns nothing when the assigned crew has recorded no language", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const [first] = staff;
    if (!first) throw new Error("seeded shop needs a staff member");
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    await setTripCrew(db, shop.id, trip.id, [first.person.id]);
    expect(await listTripSpokenLanguages(db, shop.id, trip.id)).toEqual([]);
  });

  it("never leaks a language from a genuinely different shop's trip (CR-007)", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const [first] = staff;
    if (!first) throw new Error("seeded shop needs a staff member");
    await setStaffLanguages(db, { shopId: shop.id, personId: first.person.id, languages: ["de"] });
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    await setTripCrew(db, shop.id, trip.id, [first.person.id]);

    expect(await listTripSpokenLanguages(db, FOREIGN_SHOP_ID, trip.id)).toEqual([]);
  });
});
