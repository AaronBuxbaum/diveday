import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "../test/db";
import {
  cancelUnusedCourseCodes,
  courseCodeCounts,
  courseCodesByBooking,
  issueCourseCode,
  recordCourseCodes,
  releaseCourseCode,
} from "./course-codes";
import { bookings, courseElearningCodes, trips } from "./schema/index";
import { getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

/**
 * **A shop's stock of eLearning codes and who holds which** (ADR 20261120-course-elearning-codes).
 * Bookkeeping, never a gate: running out refuses nothing but the handing-out.
 */
const ctx = fileScopedShopContext();
const OTHER_SHOP = "00000000-0000-4000-8000-0000000000ff";

async function courseContext() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = upcoming.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  const funDive = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("the seeded shop is missing a course session");
  const [courseRow] = await db
    .select({ courseId: trips.courseId })
    .from(trips)
    .where(eq(trips.id, session.id));
  const courseId = courseRow?.courseId;
  if (!courseId) throw new Error("the course session has no course");
  const students = await getTripRoster(db, shop.id, session.id);
  const [diver] = await getTripRoster(db, shop.id, funDive.id);
  const [staff] = await listStaff(db, shop.id);
  const [firstStudent] = students;
  if (!firstStudent || !diver || !staff) throw new Error("the seeded rosters are thin");
  // A second student on the same session: the fun-dive diver, seated on the course too.
  const { id: _seat, ...seatFields } = firstStudent.booking;
  const [secondSeat] = await db
    .insert(bookings)
    .values({ ...seatFields, personId: diver.person.id })
    .returning({ id: bookings.id });
  if (!secondSeat) throw new Error("could not seat a second student");
  // Each test starts with an empty stock.
  await db.delete(courseElearningCodes).where(eq(courseElearningCodes.shopId, shop.id));
  return {
    db,
    shopId: shop.id,
    courseId,
    staffId: staff.person.id,
    first: firstStudent.booking.id,
    second: secondSeat.id,
    funDive: diver.booking.id,
  };
}

describe("recordCourseCodes", () => {
  it("stocks the course and counts a repeated paste once", async () => {
    const { db, shopId, courseId } = await courseContext();
    expect(await recordCourseCodes(db, { shopId, courseId, text: "AAA1\nBBB2, AAA1" })).toEqual({
      ok: true,
      added: 2,
      skipped: 1,
    });
    expect(await recordCourseCodes(db, { shopId, courseId, text: "BBB2 CCC3" })).toEqual({
      ok: true,
      added: 1,
      skipped: 1,
    });
    expect(await courseCodeCounts(db, { shopId, courseId })).toEqual({ left: 3, handedOut: 0 });
  });

  it("adds nothing to another shop's course", async () => {
    const { db, courseId } = await courseContext();
    expect(await recordCourseCodes(db, { shopId: OTHER_SHOP, courseId, text: "ZZZ9" })).toEqual({
      ok: true,
      added: 0,
      skipped: 0,
    });
  });

  it("refuses a paste with a code no agency issues", async () => {
    const { db, shopId, courseId } = await courseContext();
    expect(await recordCourseCodes(db, { shopId, courseId, text: "x".repeat(65) })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("issueCourseCode", () => {
  it("hands out the oldest code once per seat and keeps it on a repeat", async () => {
    const { db, shopId, courseId, staffId, first, second } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1 BBB2" });
    const one = await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: staffId });
    const again = await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null });
    const two = await issueCourseCode(db, { shopId, bookingId: second, staffPersonId: null });
    expect(one).toMatchObject({ ok: true, alreadyHeld: false });
    expect(again).toEqual({
      ok: true,
      code: one.ok ? one.code : "",
      alreadyHeld: true,
    });
    expect(two.ok && two.code).not.toBe(one.ok && one.code);
    expect(await courseCodeCounts(db, { shopId, courseId })).toEqual({ left: 0, handedOut: 2 });
    expect([
      ...(await courseCodesByBooking(db, { shopId, bookingIds: [first, second] })).keys(),
    ]).toHaveLength(2);
  });

  it("says none_left when the stock is empty", async () => {
    const { db, shopId, first } = await courseContext();
    expect(await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null })).toEqual({
      ok: false,
      reason: "none_left",
    });
  });

  it("refuses a fun dive's seat and another shop's seat", async () => {
    const { db, shopId, courseId, funDive, first } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1" });
    expect(await issueCourseCode(db, { shopId, bookingId: funDive, staffPersonId: null })).toEqual({
      ok: false,
      reason: "not_a_course_session",
    });
    expect(
      await issueCourseCode(db, { shopId: OTHER_SHOP, bookingId: first, staffPersonId: null }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("two desks pressing at once give two students two codes", async () => {
    const { db, shopId, courseId, first, second } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1 BBB2" });
    const [a, b] = await Promise.all([
      issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null }),
      issueCourseCode(db, { shopId, bookingId: second, staffPersonId: null }),
    ]);
    expect(a.ok && b.ok && a.code !== b.code).toBe(true);
  });
});

describe("releaseCourseCode", () => {
  it("returns the code to stock for the next student", async () => {
    const { db, shopId, courseId, first, second } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1" });
    await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null });
    expect(await releaseCourseCode(db, { shopId, bookingId: first })).toEqual({ released: true });
    expect(await releaseCourseCode(db, { shopId, bookingId: first })).toEqual({ released: false });
    expect(
      await issueCourseCode(db, { shopId, bookingId: second, staffPersonId: null }),
    ).toMatchObject({
      ok: true,
      code: "AAA1",
    });
  });

  it("never releases another shop's code", async () => {
    const { db, shopId, courseId, first } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1" });
    await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null });
    expect(await releaseCourseCode(db, { shopId: OTHER_SHOP, bookingId: first })).toEqual({
      released: false,
    });
  });
});

describe("cancelUnusedCourseCodes", () => {
  it("removes what nobody holds, keeps a handed-out code, and lets the text be pasted again", async () => {
    const { db, shopId, courseId, first } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1 BBB2 CCC3" });
    await issueCourseCode(db, { shopId, bookingId: first, staffPersonId: null });

    expect(await cancelUnusedCourseCodes(db, { shopId, courseId })).toEqual({ removed: 2 });
    expect(await courseCodeCounts(db, { shopId, courseId })).toEqual({ left: 0, handedOut: 1 });
    expect(await recordCourseCodes(db, { shopId, courseId, text: "BBB2" })).toEqual({
      ok: true,
      added: 1,
      skipped: 0,
    });
    expect(await courseCodeCounts(db, { shopId, courseId })).toEqual({ left: 1, handedOut: 1 });
  });

  it("removes nothing of another shop's", async () => {
    const { db, shopId, courseId } = await courseContext();
    await recordCourseCodes(db, { shopId, courseId, text: "AAA1" });
    expect(await cancelUnusedCourseCodes(db, { shopId: OTHER_SHOP, courseId })).toEqual({
      removed: 0,
    });
  });
});
