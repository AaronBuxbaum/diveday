import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import { activityEvents, bookings, people, shops, trips, userAccounts } from "@/db/schema";
import { getTripRoster, listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { claimCourseFollowup } from "./followup-store";
import { getCoursePulse } from "./store";

const ctx = fileScopedShopContext();
async function fixture() {
  const { db, shop } = ctx;
  const course = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find(
    (row) => row.courseId,
  );
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((row) => row.roles.includes("owner"));
  if (!course || !owner) throw new Error("Missing seeded course or owner");
  const [seat] = await getTripRoster(db, shop.id, course.id);
  if (!seat) throw new Error("Missing seeded student");
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Student awaiting identity check" })
    .where(eq(bookings.id, seat.booking.id));
  const pulse = await getCoursePulse(db, shop.id, course.id, owner.person.id);
  const student = pulse?.rows.find((row) => row.items.length);
  if (!student) throw new Error("Missing student with preparation to finish");
  return {
    db,
    shop,
    course,
    student,
    input: {
      shopId: shop.id,
      tripId: course.id,
      bookingId: student.bookingId,
      personId: owner.person.id,
      expectedRevision: 0,
      intent: "claim" as const,
    },
  };
}

describe("course preparation follow-up ownership", () => {
  it("lets a live manager release and take over an inactive or deleted owner's work", async () => {
    const { db, shop, course, input } = await fixture();
    const managerPerson = await createPerson(db, {
      shopId: shop.id,
      fullName: "Follow-up manager",
      email: null,
      phone: null,
      origin: "counter",
      roles: ["manager"],
    });
    await db.insert(userAccounts).values({
      personId: managerPerson.id,
      email: "followup-manager@example.com",
      hashedPassword: "unused",
      status: "active",
    });
    const manager = { person: managerPerson };
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: true });
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, input.personId));
    let pulse = await getCoursePulse(db, shop.id, course.id, manager.person.id);
    expect(pulse?.followupByBooking.get(input.bookingId)).toMatchObject({
      ownerId: input.personId,
      canRelease: true,
    });
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, input.personId));
    pulse = await getCoursePulse(db, shop.id, course.id, manager.person.id);
    expect(pulse?.followupByBooking.get(input.bookingId)).toMatchObject({
      ownerId: input.personId,
      ownerName: null,
      canRelease: true,
    });
    expect(
      await claimCourseFollowup(db, {
        ...input,
        personId: manager.person.id,
        intent: "release",
        expectedRevision: 1,
      }),
    ).toEqual({ ok: true });
    expect(
      await claimCourseFollowup(db, { ...input, personId: manager.person.id, expectedRevision: 2 }),
    ).toEqual({ ok: true });
  });
  it("refuses an unknown runtime intent without releasing another claim", async () => {
    const { db, input } = await fixture();
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: true });
    expect(
      await claimCourseFollowup(db, {
        ...input,
        expectedRevision: 1,
        intent: "invalid" as "release",
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
  // story: OWN-09
  it("claims and releases work, preserving source preparedness and an atomic activity trail", async () => {
    const { db, shop, course, student, input } = await fixture();
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: true });
    const pulse = await getCoursePulse(db, shop.id, course.id, input.personId);
    expect(pulse?.rows.find((row) => row.bookingId === student.bookingId)).toEqual(student);
    expect(pulse?.followupByBooking.get(student.bookingId)).toMatchObject({
      ownerId: input.personId,
      revision: 1,
      at: expect.any(Date),
      canRelease: true,
    });
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: false, reason: "changed" });
    expect(
      await claimCourseFollowup(db, { ...input, intent: "release", expectedRevision: 1 }),
    ).toEqual({ ok: true });
    expect(
      (await getCoursePulse(db, shop.id, course.id, input.personId))?.followupByBooking.get(
        student.bookingId,
      ),
    ).toMatchObject({ ownerId: null, at: null, revision: 2 });
    const audit = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.shopId, shop.id), eq(activityEvents.bookingId, student.bookingId)),
      );
    expect(
      audit.filter((row) => row.code.startsWith("course_followup_")).map((row) => row.code),
    ).toEqual(["course_followup_claimed", "course_followup_released"]);
    expect(
      audit
        .filter((row) => row.code.startsWith("course_followup_"))
        .every(
          (row) =>
            row.audience === "staff" &&
            row.actorPersonId === input.personId &&
            row.subjectPersonId !== null,
        ),
    ).toBe(true);
  });

  it("refuses foreign scope, ordinary divers, disabled features, and canceled seats or departures", async () => {
    const { db, shop, course, input } = await fixture();
    expect(await claimCourseFollowup(db, { ...input, shopId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    const [student] = await getTripRoster(db, shop.id, course.id);
    if (!student) throw new Error("Missing student");
    expect(await claimCourseFollowup(db, { ...input, personId: student.person.id })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    await db.update(shops).set({ coursePulseEnabled: false }).where(eq(shops.id, shop.id));
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: false, reason: "unavailable" });
    await db.update(shops).set({ coursePulseEnabled: true }).where(eq(shops.id, shop.id));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, input.bookingId));
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: false, reason: "unavailable" });
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, input.bookingId));
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, course.id));
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.code, "course_followup_claimed")),
    ).toHaveLength(0);
  });

  it("does not allow an assigned instructor to release a colleague’s claim", async () => {
    const { db, shop, course, input } = await fixture();
    const instructor = (await listStaff(db, shop.id)).find(
      (row) => row.roles.includes("instructor") && row.person.id !== input.personId,
    );
    if (!instructor) throw new Error("Missing seeded instructor");
    const { tripAssignments } = await import("@/db/schema");
    await db
      .insert(tripAssignments)
      .values({ tripId: course.id, personId: instructor.person.id, tripRole: "instructor" })
      .onConflictDoNothing();
    expect(await claimCourseFollowup(db, input)).toEqual({ ok: true });
    expect(
      await claimCourseFollowup(db, {
        ...input,
        personId: instructor.person.id,
        intent: "release",
        expectedRevision: 1,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});
