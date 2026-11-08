import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getCoursePulse, recordCourseTeachingNote } from "./course-pulse";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { getTripWithBooked } from "./trips-record";

const ctx = fileScopedShopContext();
async function fixture() {
  const { db, shop } = ctx;
  const departures = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const course = departures.find((trip) => trip.courseId);
  const fun = departures.find((trip) => !trip.courseId);
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((row) => row.roles.includes("owner"));
  if (!course || !fun || !owner) throw new Error("Missing seeded course or owner");
  return { db, shop, course, fun, personId: owner.person.id };
}

describe("private course preparation", () => {
  it("saves, attributes, rejects stale overwrites and deletes a departure note", async () => {
    const { db, shop, course, personId } = await fixture();
    const input = { shopId: shop.id, tripId: course.id, personId };
    expect(
      await recordCourseTeachingNote(db, {
        ...input,
        note: "  Practice buoyancy before the navigation dive.  ",
        expectedNote: null,
      }),
    ).toEqual({ ok: true, note: "Practice buoyancy before the navigation dive." });
    const pulse = await getCoursePulse(db, shop.id, course.id, personId);
    expect(pulse?.note).toBe("Practice buoyancy before the navigation dive.");
    expect(pulse?.noteAt).toBeInstanceOf(Date);
    expect(pulse?.noteBy).toBeTruthy();
    expect(pulse?.rows.length).toBeGreaterThan(0);
    expect(
      await recordCourseTeachingNote(db, { ...input, note: "Stale tab", expectedNote: null }),
    ).toEqual({ ok: false, reason: "changed" });
    expect(
      await recordCourseTeachingNote(db, { ...input, note: "", expectedNote: pulse?.note ?? null }),
    ).toEqual({ ok: true, note: null });
    const cleared = await getCoursePulse(db, shop.id, course.id, personId);
    expect([cleared?.note, cleared?.noteAt, cleared?.noteBy]).toEqual([null, null, null]);
  });
  it("withholds private text from the general departure reader and feature-off reads", async () => {
    const { db, shop, course, personId } = await fixture();
    await recordCourseTeachingNote(db, {
      shopId: shop.id,
      tripId: course.id,
      personId,
      note: "Private lesson focus",
      expectedNote: null,
    });
    expect(await getTripWithBooked(db, shop.id, course.id)).not.toHaveProperty(
      "courseTeachingNote",
    );
    await db.update(shops).set({ coursePulseEnabled: false }).where(eq(shops.id, shop.id));
    expect(await getCoursePulse(db, shop.id, course.id, personId)).toBeNull();
    expect(
      await recordCourseTeachingNote(db, {
        shopId: shop.id,
        tripId: course.id,
        personId,
        note: "Changed",
        expectedNote: "Private lesson focus",
      }),
    ).toEqual({ ok: false, reason: "disabled" });
    await db.update(shops).set({ coursePulseEnabled: true }).where(eq(shops.id, shop.id));
    expect((await getCoursePulse(db, shop.id, course.id, personId))?.note).toBe(
      "Private lesson focus",
    );
  });
  it("uses the typed name and only staff follow-up while a student identity is held", async () => {
    const { db, shop, course, personId } = await fixture();
    const [student] = await getTripRoster(db, shop.id, course.id);
    if (!student) throw new Error("No seeded student");
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Typed student name" })
      .where(eq(bookings.id, student.booking.id));
    const pulse = await getCoursePulse(db, shop.id, course.id, personId);
    expect(pulse?.rows.find((row) => row.bookingId === student.booking.id)).toEqual({
      bookingId: student.booking.id,
      fullName: "Typed student name",
      items: ["staff"],
    });
  });
  it("requires a live instructor assignment and rechecks role revocation", async () => {
    const { db, shop, course } = await fixture();
    const [instructor] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Assigned teacher" })
      .returning();
    if (!instructor) throw new Error("No instructor");
    await db.insert(userAccounts).values({
      personId: instructor.id,
      email: "pulse-teacher@example.com",
      hashedPassword: "x",
      status: "active",
    });
    await db.insert(personRoles).values({ personId: instructor.id, role: "instructor" });
    const input = {
      shopId: shop.id,
      tripId: course.id,
      personId: instructor.id,
      note: "Navigation focus",
      expectedNote: null,
    };
    expect(await getCoursePulse(db, shop.id, course.id, instructor.id)).toBeNull();
    expect(await recordCourseTeachingNote(db, input)).toEqual({ ok: false, reason: "forbidden" });
    await db.insert(tripAssignments).values({ tripId: course.id, personId: instructor.id });
    expect((await recordCourseTeachingNote(db, input)).ok).toBe(true);
    expect((await getCoursePulse(db, shop.id, course.id, instructor.id))?.note).toBe(
      "Navigation focus",
    );
    await db
      .update(tripAssignments)
      .set({ tripRole: "captain" })
      .where(eq(tripAssignments.personId, instructor.id));
    expect(await getCoursePulse(db, shop.id, course.id, instructor.id)).toBeNull();
    await db
      .update(tripAssignments)
      .set({ tripRole: "instructor" })
      .where(eq(tripAssignments.personId, instructor.id));
    await db.delete(personRoles).where(eq(personRoles.personId, instructor.id));
    expect(await getCoursePulse(db, shop.id, course.id, instructor.id)).toBeNull();
    expect(
      await recordCourseTeachingNote(db, { ...input, expectedNote: "Navigation focus" }),
    ).toEqual({ ok: false, reason: "forbidden" });
  });
  it("refuses non-course, cancelled, deleted, cross-tenant and oversized writes", async () => {
    const { db, shop, course, fun, personId } = await fixture();
    const input = {
      shopId: shop.id,
      tripId: course.id,
      personId,
      note: "Focus",
      expectedNote: null,
    };
    expect(await recordCourseTeachingNote(db, { ...input, tripId: fun.id })).toEqual({
      ok: false,
      reason: "not_a_course_session",
    });
    expect(await recordCourseTeachingNote(db, { ...input, shopId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await recordCourseTeachingNote(db, { ...input, note: "x".repeat(601) })).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(await recordCourseTeachingNote(db, { ...input, personId: crypto.randomUUID() })).toEqual(
      { ok: false, reason: "forbidden" },
    );
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, course.id));
    expect(await getCoursePulse(db, shop.id, course.id, personId)).toBeNull();
    expect(await recordCourseTeachingNote(db, input)).toEqual({ ok: false, reason: "cancelled" });
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, course.id));
    expect(await recordCourseTeachingNote(db, input)).toEqual({ ok: false, reason: "not_found" });
  });
});
