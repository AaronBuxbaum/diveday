import { and, count, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { getTripManifest, recordCrewRollCall } from "./manifests";
import type { Course } from "./schema";
import { bookings, courses, crewAvailabilityBlocks, people, personRoles, shops } from "./schema";
import {
  changeTripCrew,
  createTrip,
  crewMoveConflicts,
  deleteTrip,
  getTripCrewAssignments,
  getTripCrewIds,
  getTripRoster,
  listStaff,
  listTripScheduleDays,
  moveTrip,
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

/**
 * **What moving a departure would ask of the people on it** (issue #1310) —
 * the move preview's only time-dependent lines.
 *
 * Two things are load-bearing here and neither is obvious:
 *
 * **The window, not the day.** A clash is a *time overlap*, computed against
 * the days the move proposes. `setTripCrew` and `changeTripCrew` already
 * define a crew conflict exactly that way and refuse it, so a morning boat
 * plus an afternoon boat is a state the shop can only be in because the model
 * deliberately allows it — an ordinary double shift for a divemaster. Calling
 * that a clash is the saturation failure #757 already paid for once.
 *
 * **The shop's zone.** These run in a shop deliberately far from UTC, because
 * every server and CI box here is UTC and a reading that quietly used the host
 * zone would answer the same on a midday instant and differently either side
 * of a shop-local midnight.
 */
describe("crewMoveConflicts", () => {
  /** A shop in Honolulu: UTC-10, no DST, so a shop day runs 10:00Z to 10:00Z. */
  async function honoluluShop(db: AppDb, shopId: string) {
    await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shopId));
    return "Pacific/Honolulu";
  }

  async function boat(
    db: AppDb,
    shopId: string,
    title: string,
    startsAt: string,
    endsAt: string,
    crew: string[],
  ) {
    const trip = await createTrip(db, {
      shopId,
      title,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      capacity: 6,
    });
    if (!trip) throw new Error(`${title} not created`);
    if (crew.length > 0) await setTripCrew(db, shopId, trip.id, crew);
    return trip;
  }

  /** The moving departure: shop-local 2030-08-01, 08:00–12:00. */
  async function movingBoat(db: AppDb, shopId: string, crew: string[]) {
    return boat(
      db,
      shopId,
      "The one being moved",
      "2030-08-01T18:00:00Z",
      "2030-08-01T22:00:00Z",
      crew,
    );
  }

  it("names the crew member whose hours the move would collide with, and the boat", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first, second] = await listStaff(db, shop.id);
    if (!first || !second) throw new Error("expected two seeded staff");

    const moving = await movingBoat(db, shop.id, [first.person.id, second.person.id]);
    // Shop-local 2030-08-05 08:00–12:00 — the same hours the move proposes.
    await boat(
      db,
      shop.id,
      "Thursday's other boat",
      "2030-08-05T18:00:00Z",
      "2030-08-05T22:00:00Z",
      [first.person.id],
    );

    const { clashes } = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      new Date("2030-08-05T18:00:00Z"),
      timeZone,
    );
    expect(clashes).toEqual([
      {
        personId: first.person.id,
        fullName: first.person.fullName,
        otherTitle: "Thursday's other boat",
      },
    ]);
  });

  /**
   * **The finding that sent the first version of this back.** A day is not a
   * conflict; overlapping hours are. A divemaster on the 08:00 and the 14:00 is
   * how a dive shop runs a Saturday, and the roster lets it happen on purpose.
   */
  it("leaves the ordinary double shift alone", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    // Shop-local 2030-08-05 14:00–18:00 — the same day, two hours after the
    // move's boat ties up.
    await boat(
      db,
      shop.id,
      "The afternoon single",
      "2030-08-06T00:00:00Z",
      "2030-08-06T04:00:00Z",
      [first.person.id],
    );

    const conflicts = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      new Date("2030-08-05T18:00:00Z"),
      timeZone,
    );
    expect(conflicts.clashes).toEqual([]);
    expect(conflicts.away).toEqual([]);
  });

  it("asks the same question the roster refuses on, so the two cannot disagree", async () => {
    // The proof rather than the claim: whatever this reports a clash for is a
    // crew list `setTripCrew` would refuse to write.
    const { db, shop } = await seededShopContext();
    await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    const other = await boat(
      db,
      shop.id,
      "Thursday's other boat",
      "2030-08-05T18:00:00Z",
      "2030-08-05T22:00:00Z",
      [],
    );
    // Move it for real — `moveTrip`, so the schedule days travel with the trip
    // row exactly as they would on the board — then ask the roster to put the
    // same person on the boat it landed beside. Refused, for the reason the
    // preview reports; a preview using a looser rule than this would be
    // warning about states the roster happily writes, and staying quiet about
    // one it does not.
    const landing = new Date("2030-08-05T18:00:00Z");
    expect((await moveTrip(db, shop.id, moving.id, landing)).ok).toBe(true);
    expect(await setTripCrew(db, shop.id, other.id, [first.person.id])).toBe(false);
  });

  /**
   * **Every leg, not only the first.** A three-day course moved by a week
   * lands on three days, and day one is the least likely of them to be the
   * problem. The preview shifts each leg by the same wall-clock delta the
   * mutation will.
   */
  it("checks every day of a multi-day departure, not only the one it starts on", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Rescue, over three days",
      startsAt: new Date("2030-08-01T18:00:00Z"),
      endsAt: new Date("2030-08-03T22:00:00Z"),
      capacity: 6,
      scheduleDays: [
        {
          dayNumber: 1,
          startsAt: new Date("2030-08-01T18:00:00Z"),
          endsAt: new Date("2030-08-01T22:00:00Z"),
        },
        {
          dayNumber: 2,
          startsAt: new Date("2030-08-02T18:00:00Z"),
          endsAt: new Date("2030-08-02T22:00:00Z"),
        },
        {
          dayNumber: 3,
          startsAt: new Date("2030-08-03T18:00:00Z"),
          endsAt: new Date("2030-08-03T22:00:00Z"),
        },
      ],
    });
    if (!course) throw new Error("course not created");
    await setTripCrew(db, shop.id, course.id, [first.person.id]);
    // A boat on what would be the course's **third** day after a four-day move.
    await boat(
      db,
      shop.id,
      "The boat on day three",
      "2030-08-07T18:00:00Z",
      "2030-08-07T22:00:00Z",
      [first.person.id],
    );

    const { clashes } = await crewMoveConflicts(
      db,
      shop.id,
      course.id,
      new Date("2030-08-05T18:00:00Z"),
      timeZone,
    );
    expect(clashes.map((row) => row.otherTitle)).toEqual(["The boat on day three"]);
  });

  it("reads the hours in the shop's zone, not the host's", async () => {
    // 2030-08-06T06:00Z is 2030-08-05, 20:00 in Honolulu. A reader working in
    // UTC would place the moving boat on the 6th and find no overlap at all —
    // green on every UTC box, wrong for the shop.
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    await boat(db, shop.id, "The evening boat", "2030-08-06T06:00:00Z", "2030-08-06T09:00:00Z", [
      first.person.id,
    ]);

    const { clashes } = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      // Shop-local 2030-08-05, 20:00 — straight into the evening boat.
      new Date("2030-08-06T06:00:00Z"),
      timeZone,
    );
    expect(clashes.map((row) => row.otherTitle)).toEqual(["The evening boat"]);
  });

  /**
   * **The line the first version of this feature was silent on.** A blackout
   * informs and never gates, so the crew stay assigned and no clash is found —
   * and a preview that asked only about clashes would say nothing at all while
   * a manager slid a whole departure onto somebody's approved holiday.
   */
  it("says who has told the shop they are away on the days it would move to", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first, second] = await listStaff(db, shop.id);
    if (!first || !second) throw new Error("expected two seeded staff");

    const moving = await movingBoat(db, shop.id, [first.person.id, second.person.id]);
    await db.insert(crewAvailabilityBlocks).values({
      shopId: shop.id,
      personId: second.person.id,
      createdByPersonId: second.person.id,
      startsOn: "2030-08-04",
      endsOn: "2030-08-06",
    });

    const conflicts = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      new Date("2030-08-05T18:00:00Z"),
      timeZone,
    );
    // Nobody is double-booked — this is the case that would otherwise be quiet.
    expect(conflicts.clashes).toEqual([]);
    expect(conflicts.away).toEqual([
      { personId: second.person.id, fullName: second.person.fullName },
    ]);

    // And a week the blackout does not touch says nothing.
    const elsewhere = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      new Date("2030-08-12T18:00:00Z"),
      timeZone,
    );
    expect(elsewhere.away).toEqual([]);
  });

  it("never counts the departure against itself", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    const { clashes } = await crewMoveConflicts(
      db,
      shop.id,
      moving.id,
      new Date("2030-08-01T18:00:00Z"),
      timeZone,
    );
    expect(clashes).toEqual([]);
  });

  it("ignores a departure that has been taken off the board or called off", async () => {
    // Both are boats nobody is standing on. `check:live-trips` refuses a read
    // of `trips` that carries neither `liveTrip()` nor a written exemption,
    // and a called-off departure holds no crew member's hours either.
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    const deleted = await boat(
      db,
      shop.id,
      "Deleted that morning",
      "2030-08-05T18:00:00Z",
      "2030-08-05T22:00:00Z",
      [first.person.id],
    );
    const at = new Date("2030-08-05T18:00:00Z");
    expect((await crewMoveConflicts(db, shop.id, moving.id, at, timeZone)).clashes).toHaveLength(1);

    await deleteTrip(db, shop.id, deleted.id);
    expect((await crewMoveConflicts(db, shop.id, moving.id, at, timeZone)).clashes).toEqual([]);
  });

  it("answers nothing for another shop's departure, or for a time it cannot read", async () => {
    const { db, shop } = await seededShopContext();
    const timeZone = await honoluluShop(db, shop.id);
    const [first] = await listStaff(db, shop.id);
    if (!first) throw new Error("expected a seeded staff member");

    const moving = await movingBoat(db, shop.id, [first.person.id]);
    await boat(
      db,
      shop.id,
      "Thursday's other boat",
      "2030-08-05T18:00:00Z",
      "2030-08-05T22:00:00Z",
      [first.person.id],
    );
    const at = new Date("2030-08-05T18:00:00Z");

    // `trip_assignments` carries no shop_id of its own (CR-007), so the trip
    // id alone must never be enough to read one shop's roster from another.
    expect((await crewMoveConflicts(db, FOREIGN_SHOP_ID, moving.id, at, timeZone)).clashes).toEqual(
      [],
    );
    // A half-typed time is not a question. The panel re-reads as its fields
    // change, and they hold nothing until every segment is filled.
    expect(
      (await crewMoveConflicts(db, shop.id, moving.id, new Date("nope"), timeZone)).clashes,
    ).toEqual([]);
  });
});
