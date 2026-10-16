// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { chartersRelyingOnCourseSeats } from "./course-dependent-seats";
import { upsertTripRequirements } from "./readiness";
import { bookings, certifications, courses, people, tripAssignments } from "./schema";
import { createTrip, listStaff } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **The charter seats a course seat carries** (issue #2058, Aaron
 * 2026-10-13): the cancel and move confirmations on a course seat name the
 * departures that were sold only on it. A warning, so the risk is in both
 * directions: naming a seat that does not rely on the course cries wolf, and
 * missing one leaves the dock to find out.
 */

const DAY = 24 * 60 * 60 * 1000;
const BASE = () => nowMs() + 60 * DAY;
let seq = 0;

async function verifiedOpenWaterDiver(db: AppDb, shopId: string) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Student ${seq}`, email: `carried-${seq}@example.com` })
    .returning({ id: people.id });
  if (!person) throw new Error("person insert failed");
  await db.insert(certifications).values({
    shopId,
    personId: person.id,
    agency: "padi",
    level: "open_water",
    identifier: `OW-CARRY-${seq}`,
    status: "verified",
  });
  return person.id;
}

async function advancedSession(db: AppDb, shopId: string, startsAt: number) {
  const [course] = await db
    .select()
    .from(courses)
    .where(
      and(eq(courses.shopId, shopId), eq(courses.sourceTemplateSlug, "advanced-open-water-diver")),
    )
    .limit(1);
  if (!course) throw new Error("seeded Advanced course missing");
  const session = await createTrip(db, {
    shopId,
    courseId: course.id,
    title: "Advanced session",
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 8 * 60 * 60 * 1000),
    capacity: 6,
  });
  if (!session) throw new Error("session not created");
  const instructor = (await listStaff(db, shopId)).find((entry) =>
    entry.roles.includes("instructor"),
  );
  if (!instructor) throw new Error("seeded instructor missing");
  await db.insert(tripAssignments).values({ tripId: session.id, personId: instructor.person.id });
  return session;
}

async function charter(
  db: AppDb,
  shopId: string,
  level: "open_water" | "advanced_open_water",
  startsAt: number,
) {
  const trip = await createTrip(db, {
    shopId,
    title: `Charter ${level}`,
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 4 * 60 * 60 * 1000),
    capacity: 10,
  });
  if (!trip) throw new Error("charter not created");
  await upsertTripRequirements(db, {
    shopId,
    tripId: trip.id,
    requiresWaiver: false,
    minimumCertificationLevel: level,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  return trip;
}

async function seat(db: AppDb, shopId: string, tripId: string, personId: string) {
  const outcome = await createBooking(db, { actor: "staff", shopId, tripId, personId });
  if (!outcome.ok) throw new Error(`booking refused: ${outcome.reason}`);
  return outcome.bookingId;
}

describe("chartersRelyingOnCourseSeats", () => {
  it("names the Advanced charter sold on the course, and not the one the card already covers", async () => {
    const { db, shop } = ctx;
    const start = BASE();
    const diver = await verifiedOpenWaterDiver(db, shop.id);
    const session = await advancedSession(db, shop.id, start);
    const courseSeat = await seat(db, shop.id, session.id, diver);
    const wall = await charter(db, shop.id, "advanced_open_water", start + 2 * DAY);
    const wallSeat = await seat(db, shop.id, wall.id, diver);
    const reef = await charter(db, shop.id, "open_water", start + 3 * DAY);
    await seat(db, shop.id, reef.id, diver);

    const carried = await chartersRelyingOnCourseSeats(
      db,
      shop.id,
      session.id,
      [{ bookingId: courseSeat, personId: diver }],
      nowDate(),
    );
    expect(carried.get(courseSeat)).toEqual([
      { bookingId: wallSeat, tripId: wall.id, title: wall.title, startsAt: wall.startsAt },
    ]);
  });

  it("names nothing when another booked course gets them there too", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 10 * DAY;
    const diver = await verifiedOpenWaterDiver(db, shop.id);
    const session = await advancedSession(db, shop.id, start);
    const other = await advancedSession(db, shop.id, start + DAY);
    const courseSeat = await seat(db, shop.id, session.id, diver);
    await seat(db, shop.id, other.id, diver);
    const wall = await charter(db, shop.id, "advanced_open_water", start + 3 * DAY);
    await seat(db, shop.id, wall.id, diver);

    const carried = await chartersRelyingOnCourseSeats(
      db,
      shop.id,
      session.id,
      [{ bookingId: courseSeat, personId: diver }],
      nowDate(),
    );
    expect(carried.size).toBe(0);
  });

  it("never names a charter before the course ends, a held charter seat, or a cancelled one", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 20 * DAY;
    const diver = await verifiedOpenWaterDiver(db, shop.id);
    const session = await advancedSession(db, shop.id, start);
    const courseSeat = await seat(db, shop.id, session.id, diver);
    // Booked before the course ends: the door refused nothing on the course
    // here, so it relies on nothing (staff seat it on an override elsewhere).
    const early = await charter(db, shop.id, "open_water", start - DAY);
    await seat(db, shop.id, early.id, diver);
    const held = await charter(db, shop.id, "advanced_open_water", start + 2 * DAY);
    const heldSeat = await seat(db, shop.id, held.id, diver);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Someone Else" })
      .where(eq(bookings.id, heldSeat));
    const gone = await charter(db, shop.id, "advanced_open_water", start + 3 * DAY);
    const goneSeat = await seat(db, shop.id, gone.id, diver);
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, goneSeat));

    const carried = await chartersRelyingOnCourseSeats(
      db,
      shop.id,
      session.id,
      [{ bookingId: courseSeat, personId: diver }],
      nowDate(),
    );
    expect(carried.size).toBe(0);
  });

  it("names nothing for a seat that is not a student's on this session", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 30 * DAY;
    const diver = await verifiedOpenWaterDiver(db, shop.id);
    const session = await advancedSession(db, shop.id, start);
    const elsewhere = await advancedSession(db, shop.id, start + DAY);
    await seat(db, shop.id, elsewhere.id, diver);
    const wall = await charter(db, shop.id, "advanced_open_water", start + 3 * DAY);
    await seat(db, shop.id, wall.id, diver);

    // The diver holds no seat on `session`; a stray id must not borrow the other course.
    const carried = await chartersRelyingOnCourseSeats(
      db,
      shop.id,
      session.id,
      [{ bookingId: "not-a-student", personId: diver }],
      nowDate(),
    );
    expect(carried.size).toBe(0);
  });
});
