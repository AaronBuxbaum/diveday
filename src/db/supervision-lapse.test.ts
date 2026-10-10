import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shiftCalendarDate } from "@/lib/calendar-date";
import { HOUR_MS, nowMs } from "@/lib/clock";
import { lastDayOfDeparture } from "@/lib/crew-roles";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { createBooking, tripCourseCrewCounts } from "./bookings";
import type { AppDb } from "./client";
import {
  bookings,
  courses,
  people,
  personRoles,
  staffCredentials,
  tripAssignments,
} from "./schema";
import { getStaffingView } from "./staffing";
import { courseCrewCountsByTrip, getTodayWork } from "./today";
import { createTrip } from "./trips";
import { getTripOverview } from "./trips-overview";

/**
 * Issue #1853: an expired instructor rating still counted toward the course
 * supervision ratio, so the staffing line could say a course was supervised
 * when its only instructor was out of teaching status.
 *
 * The owner chose shape (b): the supervision claim — Today, the staffing week,
 * the trip page — reads each rostered professional's recorded ratings, and the
 * money and roster paths keep the roster's claim, because H-59 closed new-sale
 * and new-assignment refusal on a locally recorded renewal date
 * (docs/product/human-decisions/README.md). Both halves are asserted here, against
 * the boundaries that decide them: the departure's own shop-local day, a
 * rating with no date, and two instructors with one lapsed.
 *
 * A fresh database per test rather than `fileScopedShopContext`: the booking
 * gate opens its own transaction, which that harness turns into a savepoint.
 */

/** Far enough out that no seeded crew calendar collides with these sessions. */
const SESSION_OFFSET_MS = 180 * 24 * HOUR_MS;

let seq = 0;

async function staffer(
  db: AppDb,
  shopId: string,
  name: string,
  role: "instructor" | "divemaster",
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: name, email: `lapse-staff-${seq}@example.com` })
    .returning();
  if (!person) throw new Error("failed to insert staffer");
  await db.insert(personRoles).values({ personId: person.id, role });
  return person.id;
}

const instructor = (db: AppDb, shopId: string, name: string) =>
  staffer(db, shopId, name, "instructor");
const divemaster = (db: AppDb, shopId: string, name: string) =>
  staffer(db, shopId, name, "divemaster");

async function rating(
  db: AppDb,
  shopId: string,
  personId: string,
  renewsAt: string | null,
  kind: "instructor_rating" | "divemaster_rating" = "instructor_rating",
) {
  seq += 1;
  await db.insert(staffCredentials).values({
    shopId,
    personId,
    kind,
    name: "Open Water Scuba Instructor",
    identifier: `LAPSE-${seq}`,
    renewsAt,
  });
}

async function seat(db: AppDb, shopId: string, tripId: string, count: number) {
  for (let i = 0; i < count; i++) {
    seq += 1;
    const [diver] = await db
      .insert(people)
      .values({ shopId, fullName: `Student ${seq}`, email: `lapse-student-${seq}@example.com` })
      .returning();
    if (!diver) throw new Error("failed to insert student");
    await db.insert(bookings).values({ bookedAs: "diver", shopId, tripId, personId: diver.id });
  }
}

/** An Open Water session with the given crew rostered and nobody else. */
async function session(
  db: AppDb,
  shopId: string,
  crew: string[],
  window: { startsAt: Date; endsAt: Date } = {
    startsAt: new Date(nowMs() + SESSION_OFFSET_MS),
    endsAt: new Date(nowMs() + SESSION_OFFSET_MS + 4 * HOUR_MS),
  },
  kind: "course" | "fun_dive" = "course",
) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Open Water Diver")));
  if (!course) throw new Error("Open Water Diver course missing");
  seq += 1;
  const trip = await createTrip(db, {
    shopId,
    ...(kind === "course" ? { courseId: course.id } : {}),
    title: `Lapse session ${seq}`,
    ...window,
    capacity: 20,
    plannedDives: 2,
  });
  if (!trip) throw new Error("failed to create session");
  // Straight to the rows: the crew editor's overlap and instructor refusals
  // are not what these tests are about.
  for (const personId of crew) {
    await db.insert(tripAssignments).values({ tripId: trip.id, personId });
  }
  return trip;
}

async function countsFor(db: AppDb, shopId: string, tripId: string) {
  const counts = (await courseCrewCountsByTrip(db, shopId, [tripId])).get(tripId);
  if (!counts) throw new Error("no counts");
  return counts;
}

describe("the supervision count reads recorded ratings (issue #1853)", () => {
  it("counts a rating renewing on the departure's own day, and not one that renewed the day before", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    const divesOn = lastDayOfDeparture(trip.endsAt, shop.timezone);

    await rating(db, shop.id, keiko, divesOn);
    expect(await countsFor(db, shop.id, trip.id)).toEqual({
      instructorCount: 1,
      assistantCount: 0,
      roster: { instructorCount: 1, assistantCount: 0 },
      lapsed: [],
    });

    await db
      .update(staffCredentials)
      .set({ renewsAt: shiftCalendarDate(divesOn, -1) })
      .where(eq(staffCredentials.personId, keiko));
    expect(await countsFor(db, shop.id, trip.id)).toEqual({
      instructorCount: 0,
      assistantCount: 0,
      roster: { instructorCount: 1, assistantCount: 0 },
      lapsed: [{ personId: keiko, fullName: "Keiko Tanaka", lost: "instructor" }],
    });
  });

  it("reads the departure's day in the shop's zone, not in UTC", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    // An evening session: 18:00–22:00 in the shop's zone, which ends on the
    // *next* UTC day for any shop west of Greenwich (the demo shop is New
    // York). A UTC reading would call a rating renewing on the local day
    // lapsed.
    const day = utcToWallTime(new Date(nowMs() + SESSION_OFFSET_MS), shop.timezone);
    const startsAt = wallTimeToUtc({ ...day, hour: 18, minute: 0 }, shop.timezone);
    const endsAt = wallTimeToUtc({ ...day, hour: 22, minute: 0 }, shop.timezone);
    expect(endsAt.toISOString().slice(0, 10)).not.toBe(lastDayOfDeparture(endsAt, shop.timezone));
    const trip = await session(db, shop.id, [keiko], { startsAt, endsAt });

    await rating(db, shop.id, keiko, lastDayOfDeparture(endsAt, shop.timezone));
    expect((await countsFor(db, shop.id, trip.id)).instructorCount).toBe(1);
  });

  it("counts a rating lapsing between the booking and the dive as lapsed for the dive", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    // Current today, when the seat is sold; gone a week before the session.
    const divesOn = lastDayOfDeparture(trip.endsAt, shop.timezone);
    await rating(db, shop.id, keiko, shiftCalendarDate(divesOn, -7));

    expect((await countsFor(db, shop.id, trip.id)).instructorCount).toBe(0);
  });

  it("counts an instructor with no renewal date recorded, or nothing recorded at all", async () => {
    const { db, shop } = await seededShopContext();
    const undated = await instructor(db, shop.id, "Undated Instructor");
    const unrecorded = await instructor(db, shop.id, "Unrecorded Instructor");
    await rating(db, shop.id, undated, null);
    const trip = await session(db, shop.id, [undated, unrecorded]);

    expect(await countsFor(db, shop.id, trip.id)).toEqual({
      instructorCount: 2,
      assistantCount: 0,
      roster: { instructorCount: 2, assistantCount: 0 },
      lapsed: [],
    });
  });

  it("counts two instructors with one lapsed as one, and names the lapsed one", async () => {
    const { db, shop } = await seededShopContext();
    const current = await instructor(db, shop.id, "Ana Current");
    const lapsed = await instructor(db, shop.id, "Bo Lapsed");
    const trip = await session(db, shop.id, [current, lapsed]);
    const divesOn = lastDayOfDeparture(trip.endsAt, shop.timezone);
    await rating(db, shop.id, current, shiftCalendarDate(divesOn, 365));
    await rating(db, shop.id, lapsed, shiftCalendarDate(divesOn, -1));

    expect(await countsFor(db, shop.id, trip.id)).toEqual({
      instructorCount: 1,
      assistantCount: 0,
      roster: { instructorCount: 2, assistantCount: 0 },
      lapsed: [{ personId: lapsed, fullName: "Bo Lapsed", lost: "instructor" }],
    });
  });

  it("ignores a deleted rating, and another shop's", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    const divesOn = lastDayOfDeparture(trip.endsAt, shop.timezone);
    await rating(db, shop.id, keiko, shiftCalendarDate(divesOn, -1));
    await db
      .update(staffCredentials)
      .set({ deletedAt: new Date(nowMs()) })
      .where(eq(staffCredentials.personId, keiko));

    expect((await countsFor(db, shop.id, trip.id)).instructorCount).toBe(1);
  });
});

describe("the surfaces that state the claim say why (issue #1853)", () => {
  it("puts the lapse on the staffing week's gap, beside the code it opened", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    await seat(db, shop.id, trip.id, 4);
    await rating(
      db,
      shop.id,
      keiko,
      shiftCalendarDate(lastDayOfDeparture(trip.endsAt, shop.timezone), -1),
    );

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - HOUR_MS),
      new Date(trip.endsAt.getTime() + HOUR_MS),
    );
    // Nobody current in the water and a course attached: both facts, and the
    // reason, rather than a gap that reads as a crew nobody filled in.
    expect(view.gapTrips).toEqual([
      expect.objectContaining({ tripId: trip.id, gap: "uncrewed_course", ratingLapsed: true }),
    ]);
  });

  it("leaves a staffing gap a lapse did not touch unexplained", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    // Over the Open Water cap with a current instructor: an ordinary gap.
    await seat(db, shop.id, trip.id, 9);
    await rating(
      db,
      shop.id,
      keiko,
      shiftCalendarDate(lastDayOfDeparture(trip.endsAt, shop.timezone), 30),
    );

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - HOUR_MS),
      new Date(trip.endsAt.getTime() + HOUR_MS),
    );
    expect(view.gapTrips).toEqual([
      expect.objectContaining({ tripId: trip.id, gap: "over_ratio", ratingLapsed: false }),
    ]);
  });

  it("names the lapsed instructor on Today's row instead of saying nobody is assigned", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const backup = await instructor(db, shop.id, "Divemaster Dee");
    await db.delete(personRoles).where(eq(personRoles.personId, backup));
    await db.insert(personRoles).values({ personId: backup, role: "divemaster" });
    // Inside Today's window, so the queue reads it.
    const startsAt = new Date(nowMs() + 3 * HOUR_MS);
    const trip = await session(db, shop.id, [keiko, backup], {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    });
    await seat(db, shop.id, trip.id, 2);
    await rating(
      db,
      shop.id,
      keiko,
      shiftCalendarDate(lastDayOfDeparture(trip.endsAt, shop.timezone), -1),
    );

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `instructor:${trip.id}`);
    expect(row?.kind).toBe("instructor_missing");
    expect(row?.detail).toBe("Keiko Tanaka has a rating that isn’t current for this departure.");
  });

  it("names the lapsed instructor in the trip page's crew panel", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    await seat(db, shop.id, trip.id, 2);
    await rating(
      db,
      shop.id,
      keiko,
      shiftCalendarDate(lastDayOfDeparture(trip.endsAt, shop.timezone), -1),
    );

    const overview = await getTripOverview(db, shop, trip.id, keiko);
    expect(overview?.crew.inWaterCrew).toEqual({ instructorCount: 0, assistantCount: 0 });
    expect(overview?.crew.crewGap.code).toBe("no_instructor");
    expect(overview?.crew.lapsedCrew).toEqual([{ personId: keiko, fullName: "Keiko Tanaka" }]);
  });
});

/**
 * Dive-domain review of #1853: a lapse is named only on the gap it opened.
 * Somebody aboard holding a card that isn't current is not, by itself, why a
 * session has no instructor rostered — and the shop's own divemaster target,
 * on a fun dive, reads the same narrowed count.
 */
describe("a lapse is said only where it opened the gap", () => {
  const dayBefore = (trip: { endsAt: Date }, timeZone: string) =>
    shiftCalendarDate(lastDayOfDeparture(trip.endsAt, timeZone), -1);

  it("still says no instructor is assigned when nobody rostered one, whoever else lapsed", async () => {
    const { db, shop } = await seededShopContext();
    const bea = await divemaster(db, shop.id, "Bea Lapsed");
    const cal = await divemaster(db, shop.id, "Cal Current");
    const startsAt = new Date(nowMs() + 3 * HOUR_MS);
    const trip = await session(db, shop.id, [bea, cal], {
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    });
    await seat(db, shop.id, trip.id, 2);
    await rating(db, shop.id, bea, dayBefore(trip, shop.timezone), "divemaster_rating");

    // Bea is counted out — and named as the rung she lost…
    expect((await countsFor(db, shop.id, trip.id)).lapsed).toEqual([
      { personId: bea, fullName: "Bea Lapsed", lost: "certified_assistant" },
    ]);
    // …but she is not why the session has no instructor.
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `instructor:${trip.id}`);
    expect(row?.detail).toBe("No instructor assigned.");

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - HOUR_MS),
      new Date(trip.endsAt.getTime() + HOUR_MS),
    );
    expect(view.gapTrips.filter((gap) => gap.tripId === trip.id)).toEqual([
      expect.objectContaining({ tripId: trip.id, gap: "no_instructor", ratingLapsed: false }),
    ]);
  });

  it("counts a lapsed divemaster out of a fun dive's crew, everywhere the target is read", async () => {
    const { db, shop } = await seededShopContext();
    const bea = await divemaster(db, shop.id, "Bea Lapsed");
    const startsAt = new Date(nowMs() + 3 * HOUR_MS);
    const trip = await session(
      db,
      shop.id,
      [bea],
      { startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS) },
      "fun_dive",
    );
    await seat(db, shop.id, trip.id, 4);
    await rating(db, shop.id, bea, dayBefore(trip, shop.timezone), "divemaster_rating");

    // Today: nobody current in the water, and the lapse is why.
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `uncrewed:${trip.id}`);
    expect(row?.kind).toBe("uncrewed_departure");
    expect(row?.detail).toContain("Bea Lapsed has a rating that isn’t current for this departure.");

    // The trip page's own target reads the same narrowed count.
    const overview = await getTripOverview(db, shop, trip.id, bea);
    expect(overview?.crew.ratioGap).toMatchObject({ code: "under_target", divemasterCount: 0 });

    const view = await getStaffingView(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - HOUR_MS),
      new Date(trip.endsAt.getTime() + HOUR_MS),
    );
    expect(view.gapTrips.filter((gap) => gap.tripId === trip.id)).toEqual([
      expect.objectContaining({ tripId: trip.id, gap: "uncrewed_departure", ratingLapsed: true }),
    ]);
  });

  it("puts a fun dive under the shop's target when one of its two divemasters lapsed", async () => {
    const { db, shop } = await seededShopContext();
    const bea = await divemaster(db, shop.id, "Bea Lapsed");
    const cal = await divemaster(db, shop.id, "Cal Current");
    const startsAt = new Date(nowMs() + 3 * HOUR_MS);
    const trip = await session(
      db,
      shop.id,
      [bea, cal],
      { startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS) },
      "fun_dive",
    );
    // Two divemasters cover twelve at Today's default 6:1; one does not.
    await seat(db, shop.id, trip.id, 12);
    await rating(db, shop.id, bea, dayBefore(trip, shop.timezone), "divemaster_rating");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `crew-target:${trip.id}`);
    expect(row?.kind).toBe("crew_below_target");
    expect(row?.detail).toContain("Bea Lapsed has a rating that isn’t current for this departure.");
  });

  it("does not name a lapse beside a target the roster was already short of", async () => {
    const { db, shop } = await seededShopContext();
    const bea = await divemaster(db, shop.id, "Bea Lapsed");
    const cal = await divemaster(db, shop.id, "Cal Current");
    const startsAt = new Date(nowMs() + 3 * HOUR_MS);
    const trip = await session(
      db,
      shop.id,
      [bea, cal],
      { startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS) },
      "fun_dive",
    );
    // Eighteen wants three at 6:1: short with Bea counted, short without her.
    await seat(db, shop.id, trip.id, 18);
    await rating(db, shop.id, bea, dayBefore(trip, shop.timezone), "divemaster_rating");

    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone);
    const row = work.actions.find((action) => action.id === `crew-target:${trip.id}`);
    expect(row?.kind).toBe("crew_below_target");
    expect(row?.detail).not.toContain("isn’t current");
  });
});

/**
 * H-59 is not reopened by this: a locally recorded renewal date never refuses
 * a sale or a seat. These are the adversarial half — the lapse is in place,
 * and the money path must not have noticed.
 */
describe("selling and seating keep the roster's claim (H-59)", () => {
  it("still sells a seat on a session whose only instructor's rating lapsed", async () => {
    const { db, shop } = await seededShopContext();
    const keiko = await instructor(db, shop.id, "Keiko Tanaka");
    const trip = await session(db, shop.id, [keiko]);
    await rating(
      db,
      shop.id,
      keiko,
      shiftCalendarDate(lastDayOfDeparture(trip.endsAt, shop.timezone), -1),
    );
    // The supervision claim says nobody current is aboard…
    expect((await countsFor(db, shop.id, trip.id)).instructorCount).toBe(0);

    // …and the booking gate, deliberately, has not heard: no
    // `course_unstaffed`, and the seat cap is the roster's.
    expect(await tripCourseCrewCounts(db, trip.id)).toEqual({
      instructorCount: 1,
      assistantCount: 0,
    });
    await expect(
      createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Still Sold",
        email: "lapse-still-sold@example.com",
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
