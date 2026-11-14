// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { restoreCard } from "../features/card-restore/store";
import { markBookingNoShow, undoBookingNoShow } from "../features/no-show/store";
import { cancelBooking, createBooking, restoreBooking } from "./bookings";
import type { AppDb } from "./client";
import { deleteCertification } from "./readiness";
import { activityEvents, bookings, cards, courses, people, tripAssignments } from "./schema";
import { createTrip, listStaff, setTripCrew } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **An undo is a seat-granting write, and a course session asks it every gate
 * the sale asks** (issues #3769 and #3686). Undoing a removal
 * (`restoreBooking`) and undoing "Not here" (`undoBookingNoShow`) put a
 * student back on a session; until these issues they re-asked only the crew's
 * ratio, so a session that lost its instructor, a card revoked since the sale
 * or a date of birth recorded since all let the seat back. Each case below
 * changes one fact between the release and the undo, and expects the undo to
 * refuse with the sale's own code and leave the seat released.
 */

/** 200 days out: clear of the seeded instructor's calendar whatever the hour. */
const OFFSET_MS = 200 * 24 * 60 * 60 * 1000;
let seq = 0;

/**
 * The session's last instructor gone from its crew. `setTripCrew` refuses to
 * leave a course session without one, but a session gets there anyway (a
 * staffer deactivated, a per-trip role changed): the state is written
 * directly, because what is under test is the undo, not how the crew emptied.
 */
async function emptyCrew(db: AppDb, tripId: string) {
  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
}

async function session(db: AppDb, shopId: string, courseTitle: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, courseTitle)));
  if (!course) throw new Error(`${courseTitle} missing`);
  const staff = await listStaff(db, shopId);
  const instructor = staff.find((entry) => entry.roles.includes("instructor"));
  if (!instructor) throw new Error("seeded instructor missing");
  seq += 1;
  const startsAt = nowMs() + OFFSET_MS + seq * 6 * 60 * 60 * 1000;
  const trip = await createTrip(db, {
    shopId,
    courseId: course.id,
    title: `${courseTitle} — undo gates ${seq}`,
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 4 * 60 * 60 * 1000),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("session not created");
  if (!(await setTripCrew(db, shopId, trip.id, [instructor.person.id]))) {
    throw new Error("instructor not assigned");
  }
  return { trip, course, staffId: instructor.person.id };
}

/** A diver holding a verified Open Water card, seated by staff. */
async function seatCardedStudent(db: AppDb, shopId: string, tripId: string) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Undo Student ${seq}`, email: `undo-student-${seq}@example.com` })
    .returning();
  if (!person) throw new Error("student not inserted");
  const [card] = await db
    .insert(cards)
    .values({
      kind: "level",
      shopId,
      personId: person.id,
      agency: "padi",
      level: "open_water",
      identifier: `UNDO-${seq}`,
      status: "verified",
    })
    .returning({ id: cards.id });
  if (!card) throw new Error("card not inserted");
  const booked = await createBooking(db, { actor: "staff", shopId, tripId, personId: person.id });
  if (!booked.ok) throw new Error(`student refused at the sale: ${booked.reason}`);
  return { personId: person.id, cardId: card.id, bookingId: booked.bookingId };
}

async function statusOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

/** A date of birth that is `years` old, give or take a day, on `at`. */
function bornYearsBefore(at: Date, years: number) {
  const d = new Date(at.getTime() + 2 * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear() - years}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

describe("restoreBooking on a course session", () => {
  it("refuses an undo onto a session with no instructor, when the course has no ratio", async () => {
    const { db, shop } = ctx;
    // Advanced Open Water carries no in-water ratio: only staffing can refuse.
    const { trip } = await session(db, shop.id, "Advanced Open Water Diver");
    const student = await seatCardedStudent(db, shop.id, trip.id);
    await cancelBooking(db, shop.id, student.bookingId);
    await emptyCrew(db, trip.id);

    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("course_unstaffed");
    expect(await statusOf(db, student.bookingId)).toBe("cancelled");
  });

  it("refuses an undo once the student's prerequisite card is gone", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await session(db, shop.id, "Advanced Open Water Diver");
    const student = await seatCardedStudent(db, shop.id, trip.id);
    await cancelBooking(db, shop.id, student.bookingId);
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: student.cardId,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);

    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("course_prerequisite");
    expect(await statusOf(db, student.bookingId)).toBe("cancelled");
  });

  it("refuses an undo for a student the session's day finds too young", async () => {
    const { db, shop } = ctx;
    const { trip, course } = await session(db, shop.id, "Advanced Open Water Diver");
    const minimumAge = course.minimumAge ?? 12;
    if (course.minimumAge === null) {
      await db.update(courses).set({ minimumAge }).where(eq(courses.id, course.id));
    }
    // Sold with no date of birth on file: the age gate fails open at the sale.
    const student = await seatCardedStudent(db, shop.id, trip.id);
    await cancelBooking(db, shop.id, student.bookingId);
    await db
      .update(people)
      .set({ dateOfBirth: bornYearsBefore(trip.startsAt, minimumAge) })
      .where(eq(people.id, student.personId));

    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("course_min_age");
    expect(await statusOf(db, student.bookingId)).toBe("cancelled");
  });

  it("asks staffing of a rider too: an undo onto an unstaffed session refuses", async () => {
    const { db, shop } = ctx;
    const { trip } = await session(db, shop.id, "Advanced Open Water Diver");
    const rider = await seatCardedStudent(db, shop.id, trip.id);
    // The sale refuses a rider on a course session, so the seat is written as one.
    await db
      .update(bookings)
      .set({ participantType: "rider" })
      .where(eq(bookings.id, rider.bookingId));
    await cancelBooking(db, shop.id, rider.bookingId);
    await emptyCrew(db, trip.id);

    expect(await restoreBooking(db, shop.id, rider.bookingId)).toBe("course_unstaffed");
    expect(await statusOf(db, rider.bookingId)).toBe("cancelled");
  });

  it("holds the seat until the card's own Undo lands, when the card went first", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await session(db, shop.id, "Advanced Open Water Diver");
    const student = await seatCardedStudent(db, shop.id, trip.id);
    // The desk's mistaken order: the card deleted, then the student removed.
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: student.cardId,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);
    await cancelBooking(db, shop.id, student.bookingId);

    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("course_prerequisite");
    expect(await statusOf(db, student.bookingId)).toBe("cancelled");
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: student.cardId,
        restoredByPersonId: staffId,
      }),
    ).toBe("restored");
    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("restored");
    expect(await statusOf(db, student.bookingId)).toBe("booked");
  });

  it("still restores a student who clears every gate", async () => {
    const { db, shop } = ctx;
    const { trip } = await session(db, shop.id, "Advanced Open Water Diver");
    const student = await seatCardedStudent(db, shop.id, trip.id);
    await cancelBooking(db, shop.id, student.bookingId);

    expect(await restoreBooking(db, shop.id, student.bookingId)).toBe("restored");
    expect(await statusOf(db, student.bookingId)).toBe("booked");
  });
});

describe("undoBookingNoShow on a course session", () => {
  async function released(courseTitle: string) {
    const { db, shop } = ctx;
    const { trip, course, staffId } = await session(db, shop.id, courseTitle);
    const student = await seatCardedStudent(db, shop.id, trip.id);
    const now = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: student.bookingId,
        recordedByPersonId: staffId,
        now,
      }),
    ).toMatchObject({ ok: true });
    const undo = () =>
      undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: student.bookingId,
        recordedByPersonId: staffId,
        now,
      });
    return { db, shop, trip, course, staffId, student, undo };
  }

  async function refusedReasons(db: AppDb, bookingId: string) {
    const rows = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, bookingId),
          eq(activityEvents.code, "booking_no_show_undo_refused"),
        ),
      );
    return rows.map((row) => (row.params as { reason?: string }).reason);
  }

  it("refuses onto a session with no instructor, and the trail names it", async () => {
    const { db, trip, student, undo } = await released("Advanced Open Water Diver");
    await emptyCrew(db, trip.id);

    expect(await undo()).toMatchObject({
      ok: true,
      state: "conflict",
      conflict: "course_unstaffed",
    });
    expect(await statusOf(db, student.bookingId)).toBe("no_show");
    expect(await refusedReasons(db, student.bookingId)).toEqual(["course_unstaffed"]);
  });

  it("refuses once the student's prerequisite card is gone", async () => {
    const { db, shop, staffId, student, undo } = await released("Advanced Open Water Diver");
    await deleteCertification(db, {
      shopId: shop.id,
      certificationId: student.cardId,
      deletedByPersonId: staffId,
    });

    expect(await undo()).toMatchObject({
      ok: true,
      state: "conflict",
      conflict: "course_prerequisite",
    });
    expect(await statusOf(db, student.bookingId)).toBe("no_show");
    expect(await refusedReasons(db, student.bookingId)).toEqual(["course_prerequisite"]);
  });

  it("refuses a student the session's day finds too young", async () => {
    const { db, trip, course, student, undo } = await released("Advanced Open Water Diver");
    const minimumAge = course.minimumAge ?? 12;
    if (course.minimumAge === null) {
      await db.update(courses).set({ minimumAge }).where(eq(courses.id, course.id));
    }
    await db
      .update(people)
      .set({ dateOfBirth: bornYearsBefore(trip.startsAt, minimumAge) })
      .where(eq(people.id, student.personId));

    expect(await undo()).toMatchObject({ ok: true, state: "conflict", conflict: "course_min_age" });
    expect(await statusOf(db, student.bookingId)).toBe("no_show");
    expect(await refusedReasons(db, student.bookingId)).toEqual(["course_min_age"]);
  });

  it("still puts back a student who clears every gate", async () => {
    const { db, student, undo } = await released("Advanced Open Water Diver");
    expect(await undo()).toMatchObject({ ok: true });
    expect(await statusOf(db, student.bookingId)).toBe("booked");
  });
});
