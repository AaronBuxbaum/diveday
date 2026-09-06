import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { courseNextStepsByBooking, recordCourseNextStep } from "./course-next-step";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **What an instructor tells a student to do next** (issues #1196 and #1205).
 *
 * The refusal on a departure with no course is the LMS boundary and the first
 * case below: DiveDay records a sentence an instructor wrote on a course day,
 * and nothing about it may drift into a curriculum the software keeps.
 */
async function courseContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = trips.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  const funDive = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("the seeded shop is missing a course session");
  const [student] = await getTripRoster(db, shop.id, session.id);
  const [diver] = await getTripRoster(db, shop.id, funDive.id);
  if (!student || !diver) throw new Error("the seeded departures have empty rosters");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("the seeded shop has no staff");
  return {
    db,
    shop,
    instructorId: staff.person.id,
    studentBookingId: student.booking.id,
    funDiveBookingId: diver.booking.id,
  };
}

const stored = async (db: Awaited<ReturnType<typeof courseContext>>["db"], bookingId: string) => {
  const [row] = await db
    .select({
      note: bookings.courseNextStep,
      at: bookings.courseNextStepAt,
      by: bookings.courseNextStepByPersonId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
};

describe("recordCourseNextStep", () => {
  it("writes the words, the moment, and who wrote them", async () => {
    const { db, shop, instructorId, studentBookingId } = await courseContext();
    expect(
      await recordCourseNextStep(db, {
        shopId: shop.id,
        bookingId: studentBookingId,
        instructorPersonId: instructorId,
        note: "  Book your deep dive before the card arrives.  ",
      }),
    ).toEqual({ ok: true });

    const row = await stored(db, studentBookingId);
    expect(row?.note).toBe("Book your deep dive before the card arrives.");
    expect(row?.at).toBeInstanceOf(Date);
    expect(row?.by).toBe(instructorId);
  });

  it("rewrites in place rather than stacking a second note", async () => {
    const { db, shop, instructorId, studentBookingId } = await courseContext();
    const base = {
      shopId: shop.id,
      bookingId: studentBookingId,
      instructorPersonId: instructorId,
    };
    await recordCourseNextStep(db, { ...base, note: "Practise your buoyancy." });
    expect(await recordCourseNextStep(db, { ...base, note: "Log the Duane dive." })).toEqual({
      ok: true,
    });
    expect((await stored(db, studentBookingId))?.note).toBe("Log the Duane dive.");
  });

  it("clears all three columns when the words are taken away", async () => {
    // The check constraint is real under PGlite, so a half-clear would fail
    // here rather than in production.
    const { db, shop, instructorId, studentBookingId } = await courseContext();
    const base = {
      shopId: shop.id,
      bookingId: studentBookingId,
      instructorPersonId: instructorId,
    };
    await recordCourseNextStep(db, { ...base, note: "Practise your buoyancy." });
    expect(await recordCourseNextStep(db, { ...base, note: "   " })).toEqual({ ok: true });

    const row = await stored(db, studentBookingId);
    expect(row?.note).toBeNull();
    expect(row?.at).toBeNull();
    expect(row?.by).toBeNull();
  });

  it("refuses a departure that teaches no course, and writes nothing", async () => {
    // The boundary, in code: a next step belongs to a course session, and a
    // fun dive has no session for it to be a step of.
    const { db, shop, instructorId, funDiveBookingId } = await courseContext();
    expect(
      await recordCourseNextStep(db, {
        shopId: shop.id,
        bookingId: funDiveBookingId,
        instructorPersonId: instructorId,
        note: "Try the wreck next.",
      }),
    ).toEqual({ ok: false, reason: "not_a_course_session" });
    expect((await stored(db, funDiveBookingId))?.note).toBeNull();
  });

  it("refuses a note longer than the column allows, before it reaches the row", async () => {
    const { db, shop, instructorId, studentBookingId } = await courseContext();
    expect(
      await recordCourseNextStep(db, {
        shopId: shop.id,
        bookingId: studentBookingId,
        instructorPersonId: instructorId,
        note: "x".repeat(281),
      }),
    ).toEqual({ ok: false, reason: "too_long" });
    expect((await stored(db, studentBookingId))?.note).toBeNull();
  });

  it("refuses a booking that is not this shop's", async () => {
    // Scoped by shop as well as by booking id, so a caller holding somebody
    // else's booking id writes nothing.
    const { db, instructorId, studentBookingId } = await courseContext();
    expect(
      await recordCourseNextStep(db, {
        shopId: "00000000-0000-4000-8000-0000000000ff",
        bookingId: studentBookingId,
        instructorPersonId: instructorId,
        note: "Book your deep dive.",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await stored(db, studentBookingId))?.note).toBeNull();
  });
});

describe("courseNextStepsByBooking", () => {
  it("hands the roster back what it already said, and nothing for a seat with none", async () => {
    const { db, shop, instructorId, studentBookingId } = await courseContext();
    expect(
      (await courseNextStepsByBooking(db, shop.id, "00000000-0000-4000-8000-000000000000")).size,
    ).toBe(0);
    await recordCourseNextStep(db, {
      shopId: shop.id,
      bookingId: studentBookingId,
      instructorPersonId: instructorId,
      note: "Book your deep dive.",
    });
    const [{ booking }] = await getTripRoster(
      db,
      shop.id,
      (
        await db
          .select({ tripId: bookings.tripId })
          .from(bookings)
          .where(eq(bookings.id, studentBookingId))
      )[0].tripId,
    );
    const notes = await courseNextStepsByBooking(db, shop.id, booking.tripId);
    expect(notes.get(studentBookingId)).toBe("Book your deep dive.");
  });
});
