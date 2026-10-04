import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { listTripReadiness, upsertTripRequirements } from "./readiness";
import { type certificationLevel, certifications, courses, tripAssignments } from "./schema";
import { createTrip, listStaff } from "./trips";

/**
 * **A diver booked on the course that gets them there** (Aaron, 2026-10-04):
 * a fun dive the morning after an Open Water course is something a shop sells
 * every week, and the card it needs does not exist until the course ends.
 *
 * Both gates read the same course seats (`listCourseSeatsInTraining`). The
 * sale lets the seat go; boarding still waits for the card the instructor
 * issues, and says so in softer words than a diver booked above their card.
 */

const ctx = fileScopedShopContext();

const DAY = 24 * 60 * 60 * 1000;
/** Far enough ahead that nothing in the demo week collides with it. */
const BASE = () => nowMs() + 40 * DAY;

type Level = (typeof certificationLevel.enumValues)[number];

async function courseSession(db: AppDb, shopId: string, templateSlug: string, startsAt: number) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.sourceTemplateSlug, templateSlug)))
    .limit(1);
  if (!course) throw new Error(`seeded ${templateSlug} course missing`);
  const session = await createTrip(db, {
    shopId,
    courseId: course.id,
    title: `${course.title} session`,
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 8 * 60 * 60 * 1000),
    capacity: 6,
  });
  if (!session) throw new Error("course session not created");
  const instructor = (await listStaff(db, shopId)).find((entry) =>
    entry.roles.includes("instructor"),
  );
  if (!instructor) throw new Error("seeded instructor missing");
  await db.insert(tripAssignments).values({ tripId: session.id, personId: instructor.person.id });
  return session;
}

async function funDive(db: AppDb, shopId: string, level: Level, startsAt: number) {
  const trip = await createTrip(db, {
    shopId,
    title: "Fun dive",
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + 4 * 60 * 60 * 1000),
    capacity: 10,
  });
  if (!trip) throw new Error("fun dive not created");
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

async function book(db: AppDb, shopId: string, tripId: string, person: string | { name: string }) {
  const outcome = await createBooking(
    db,
    typeof person === "string"
      ? { actor: "staff", shopId, tripId, personId: person }
      : {
          actor: "staff",
          shopId,
          tripId,
          fullName: person.name,
          email: `${person.name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
        },
  );
  return outcome;
}

async function certificationCodes(db: AppDb, shopId: string, tripId: string, personId: string) {
  const roster = await listTripReadiness(db, shopId, tripId);
  const row = roster.find((entry) => entry.person.id === personId);
  if (!row) throw new Error("diver missing from roster");
  return row.readiness.blockers
    .filter((blocker) => blocker.code.startsWith("certification"))
    .map((blocker) => blocker.code);
}

describe("a fun dive after the course that certifies for it", () => {
  it("is a planned blocker, not a missing card, until the instructor issues the card", async () => {
    const { db, shop } = ctx;
    const start = BASE();
    const ow = await courseSession(db, shop.id, "open-water-diver", start);
    const student = await book(db, shop.id, ow.id, { name: "Mila Novak" });
    if (!student.ok) throw new Error(`course booking refused: ${student.reason}`);

    const nextMorning = await funDive(db, shop.id, "open_water", start + DAY);
    const seat = await book(db, shop.id, nextMorning.id, student.personId);
    expect(seat).toMatchObject({ ok: true });

    expect(await certificationCodes(db, shop.id, nextMorning.id, student.personId)).toEqual([
      "certification_in_training",
    ]);

    // The card the instructor issues is what clears it, as for anyone else.
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: student.personId,
      agency: "padi",
      level: "open_water",
      identifier: "OW-NOVAK-1",
      status: "verified",
    });
    expect(await certificationCodes(db, shop.id, nextMorning.id, student.personId)).toEqual([]);
  });

  it("does not count a course that finishes after the trip sails", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 3 * DAY;
    const ow = await courseSession(db, shop.id, "open-water-diver", start);
    const student = await book(db, shop.id, ow.id, { name: "Ines Carvalho" });
    if (!student.ok) throw new Error(`course booking refused: ${student.reason}`);

    const dayBefore = await funDive(db, shop.id, "open_water", start - DAY);
    await book(db, shop.id, dayBefore.id, student.personId);
    expect(await certificationCodes(db, shop.id, dayBefore.id, student.personId)).toEqual([
      "certification_missing",
    ]);
  });

  it("sells an Advanced seat to an Open Water diver finishing Advanced first, and refuses one who is not", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 6 * DAY;
    const carded = async (name: string) => {
      const seat = await book(db, shop.id, (await funDive(db, shop.id, "open_water", start)).id, {
        name,
      });
      if (!seat.ok) throw new Error(`seed booking refused: ${seat.reason}`);
      await db.insert(certifications).values({
        shopId: shop.id,
        personId: seat.personId,
        agency: "padi",
        level: "open_water",
        identifier: `OW-${name}`,
        status: "verified",
      });
      return seat.personId;
    };
    const enrolled = await carded("Tomas Ruiz");
    const notEnrolled = await carded("Ada Brennan");

    const aow = await courseSession(db, shop.id, "advanced-open-water-diver", start + DAY);
    expect(await book(db, shop.id, aow.id, enrolled)).toMatchObject({ ok: true });

    const wreck = await funDive(db, shop.id, "advanced_open_water", start + 3 * DAY);
    expect(await book(db, shop.id, wreck.id, enrolled)).toMatchObject({ ok: true });
    expect(await book(db, shop.id, wreck.id, notEnrolled)).toMatchObject({
      ok: false,
      reason: "trip_prerequisite",
    });
    expect(await certificationCodes(db, shop.id, wreck.id, enrolled)).toEqual([
      "certification_in_training",
    ]);
  });

  it("lets a student book Advanced straight after the Open Water course that qualifies them", async () => {
    const { db, shop } = ctx;
    const start = BASE() + 10 * DAY;
    const ow = await courseSession(db, shop.id, "open-water-diver", start);
    const student = await book(db, shop.id, ow.id, { name: "Lior Ben-David" });
    if (!student.ok) throw new Error(`course booking refused: ${student.reason}`);

    const aowAfter = await courseSession(db, shop.id, "advanced-open-water-diver", start + 2 * DAY);
    expect(await book(db, shop.id, aowAfter.id, student.personId)).toMatchObject({ ok: true });

    // The same pair the other way round is still refused: Advanced first, then
    // the course that would have qualified them for it.
    const second = await book(db, shop.id, ow.id, { name: "Ruth Okoye" });
    if (!second.ok) throw new Error(`course booking refused: ${second.reason}`);
    const aowBefore = await courseSession(
      db,
      shop.id,
      "advanced-open-water-diver",
      start - 2 * DAY,
    );
    expect(await book(db, shop.id, aowBefore.id, second.personId)).toEqual({
      ok: false,
      reason: "course_prerequisite",
    });
  });
});
