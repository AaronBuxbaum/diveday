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
 * (docs/product/human-decisions.md). Both halves are asserted here, against
 * the boundaries that decide them: the departure's own shop-local day, a
 * rating with no date, and two instructors with one lapsed.
 *
 * A fresh database per test rather than `fileScopedShopContext`: the booking
 * gate opens its own transaction, which that harness turns into a savepoint.
 */

/** Far enough out that no seeded crew calendar collides with these sessions. */
const SESSION_OFFSET_MS = 180 * 24 * HOUR_MS;

let seq = 0;

async function instructor(db: AppDb, shopId: string, name: string): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: name, email: `lapse-instructor-${seq}@example.com` })
    .returning();
  if (!person) throw new Error("failed to insert instructor");
  await db.insert(personRoles).values({ personId: person.id, role: "instructor" });
  return person.id;
}

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
    await db.insert(bookings).values({ shopId, tripId, personId: diver.id });
  }
}

/** An Open Water session with the given instructors rostered and nobody else. */
async function session(
  db: AppDb,
  shopId: string,
  crew: string[],
  window: { startsAt: Date; endsAt: Date } = {
    startsAt: new Date(nowMs() + SESSION_OFFSET_MS),
    endsAt: new Date(nowMs() + SESSION_OFFSET_MS + 4 * HOUR_MS),
  },
) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Open Water Diver")));
  if (!course) throw new Error("Open Water Diver course missing");
  seq += 1;
  const trip = await createTrip(db, {
    shopId,
    courseId: course.id,
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
      lapsed: [],
    });

    await db
      .update(staffCredentials)
      .set({ renewsAt: shiftCalendarDate(divesOn, -1) })
      .where(eq(staffCredentials.personId, keiko));
    expect(await countsFor(db, shop.id, trip.id)).toEqual({
      instructorCount: 0,
      assistantCount: 0,
      lapsed: [{ personId: keiko, fullName: "Keiko Tanaka" }],
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
      lapsed: [{ personId: lapsed, fullName: "Bo Lapsed" }],
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
    expect(row?.detail).toBe("Keiko Tanaka has a rating that lapses before this departure.");
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
