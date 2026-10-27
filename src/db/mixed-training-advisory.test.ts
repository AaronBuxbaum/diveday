import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { mixedTrainingAdvisories } from "./mixed-training-advisory";
import {
  bookings,
  courses,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { createTrip, listStaff, setTripCrew, updateTrip } from "./trips";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const intro = catalog.find((course) => course.isIntroCourse);
  const entry = catalog.find(
    (course) =>
      !course.isIntroCourse &&
      course.agency.toLowerCase() === "padi" &&
      !course.minimumCertificationLevel,
  );
  const staff = await listStaff(db, shop.id);
  const instructor = staff.find((person) => person.roles.includes("instructor"));
  if (!intro || !entry || !instructor) throw new Error("seeded courses or instructor missing");
  const startsAt = new Date(nowMs() + 200 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
  const make = (courseId: string, title: string) =>
    createTrip(db, {
      shopId: shop.id,
      courseId,
      title,
      startsAt,
      endsAt,
      capacity: 12,
      plannedDives: 1,
    });
  const a = await make(intro.id, "Intro advisory fixture");
  const b = await make(entry.id, "Entry advisory fixture");
  if (!a || !b) throw new Error("sessions not created");
  await db.insert(tripAssignments).values([
    { tripId: a.id, personId: instructor.person.id },
    { tripId: b.id, personId: instructor.person.id },
  ]);
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: b.id,
    fullName: "Advisory student",
    email: "advisory@example.test",
  });
  if (!booking.ok) throw new Error(`student not booked: ${booking.reason}`);
  return { db, shop, a, b, instructor, booking };
}

describe("mixed training advisory", () => {
  it("finds an overlapping enrolled session but does not change admission", async () => {
    const { db, shop, a, b } = await fixture();
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toMatchObject([
      { tripId: b.id, title: b.title },
    ]);
    const added = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: a.id,
      fullName: "Intro student",
      email: "intro@example.test",
    });
    expect(added.ok).toBe(true);
    expect(await mixedTrainingAdvisories(db, shop.id, b.id)).toMatchObject([
      { tripId: a.id, title: a.title },
    ]);
  });

  it("does not warn on canceled sessions or across shops", async () => {
    const { db, shop, a, b } = await fixture();
    expect(await mixedTrainingAdvisories(db, crypto.randomUUID(), a.id)).toEqual([]);
    await db
      .update(trips)
      .set({ status: "cancelled" })
      .where(and(eq(trips.shopId, shop.id), eq(trips.id, b.id)));
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toEqual([]);
  });

  it("uses meeting days rather than the continuous outer trip window", async () => {
    const { db, shop, a, b } = await fixture();
    await db
      .update(tripScheduleDays)
      .set({
        startsAt: new Date(b.endsAt.getTime()),
        endsAt: new Date(b.endsAt.getTime() + 3_600_000),
      })
      .where(eq(tripScheduleDays.tripId, b.id));
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toEqual([]);
  });

  it("counts potential assignments and held enrollments regardless of roll call, but excludes canceled seats", async () => {
    const { db, shop, a, b, instructor, booking } = await fixture();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, booking.bookingId));
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toHaveLength(1);
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: b.id,
      bookingId: booking.bookingId,
      recordedByPersonId: instructor.person.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: b.startsAt,
    });
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toHaveLength(1);
    await db
      .update(tripAssignments)
      .set({ tripRole: "crew" })
      .where(
        and(eq(tripAssignments.tripId, b.id), eq(tripAssignments.personId, instructor.person.id)),
      );
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toEqual([]);
    await db
      .update(tripAssignments)
      .set({ tripRole: "instructor", assignedByPersonId: instructor.person.id })
      .where(
        and(eq(tripAssignments.tripId, b.id), eq(tripAssignments.personId, instructor.person.id)),
      );
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toHaveLength(1);
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, booking.bookingId));
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toEqual([]);
  });

  it("detects an overlap created by the normal crew assignment and a later move", async () => {
    const { db, shop, a, b, instructor } = await fixture();
    await db.delete(tripAssignments).where(eq(tripAssignments.tripId, b.id));
    const move = (start: Date, end: Date) =>
      updateTrip(db, shop.id, b.id, {
        title: b.title,
        startsAt: start,
        endsAt: end,
        capacity: b.capacity,
        plannedDives: 1,
        scheduleDays: [{ dayNumber: 1, startsAt: start, endsAt: end }],
      });
    const later = new Date(a.startsAt.getTime() + 24 * 3_600_000);
    expect((await move(later, new Date(later.getTime() + 4 * 3_600_000))).ok).toBe(true);
    expect(await setTripCrew(db, shop.id, b.id, [instructor.person.id])).toBe(true);
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toEqual([]);
    expect((await move(a.startsAt, a.endsAt)).ok).toBe(true);
    expect(await mixedTrainingAdvisories(db, shop.id, a.id)).toMatchObject([{ tripId: b.id }]);
  });
});
