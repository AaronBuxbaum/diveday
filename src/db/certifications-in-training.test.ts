import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { inTrainingBefore, listCourseSeatsInTraining } from "./certifications-in-training";
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

  it("leaves the course prerequisite as it was: Advanced still asks for a certified Open Water card", async () => {
    // H-08's course baseline (human-decisions.md, "Course admission") is the
    // owner's rule; enrolling in Open Water does not stand in for the card.
    const { db, shop } = ctx;
    const start = BASE() + 10 * DAY;
    const ow = await courseSession(db, shop.id, "open-water-diver", start);
    const student = await book(db, shop.id, ow.id, { name: "Lior Ben-David" });
    if (!student.ok) throw new Error(`course booking refused: ${student.reason}`);

    const aowAfter = await courseSession(db, shop.id, "advanced-open-water-diver", start + 2 * DAY);
    expect(await book(db, shop.id, aowAfter.id, student.personId)).toEqual({
      ok: false,
      reason: "course_prerequisite",
    });
  });
});

describe("listCourseSeatsInTraining reads the course's own level (issue #2059)", () => {
  async function courseWith(
    db: AppDb,
    shopId: string,
    fields: { title: string; sourceTemplateSlug: string | null; certifiesLevel: Level | null },
  ) {
    const [course] = await db
      .insert(courses)
      .values({ shopId, slug: fields.title.toLowerCase().replace(/\W+/g, "-"), ...fields })
      .returning();
    if (!course) throw new Error("course insert failed");
    const session = await createTrip(db, {
      shopId,
      courseId: course.id,
      title: `${fields.title} session`,
      startsAt: new Date(BASE() + 20 * DAY),
      endsAt: new Date(BASE() + 20 * DAY + 8 * 60 * 60 * 1000),
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

  it("counts a course the shop built itself when it carries a level", async () => {
    const { db, shop } = ctx;
    const session = await courseWith(db, shop.id, {
      title: "House Advanced Programme",
      sourceTemplateSlug: null,
      certifiesLevel: "advanced_open_water",
    });
    const seat = await book(db, shop.id, session.id, { name: "Ren Okafor" });
    if (!seat.ok) throw new Error(`booking refused: ${seat.reason}`);
    expect(await listCourseSeatsInTraining(db, shop.id, [seat.personId])).toEqual([
      expect.objectContaining({ tripId: session.id, level: "advanced_open_water" }),
    ]);
  });

  it("counts nothing for a course with no level, whatever template it started from", async () => {
    const { db, shop } = ctx;
    const session = await courseWith(db, shop.id, {
      title: "Open Water Taster Rewrite",
      sourceTemplateSlug: "open-water-diver",
      certifiesLevel: null,
    });
    const seat = await book(db, shop.id, session.id, { name: "Saoirse Daly" });
    if (!seat.ok) throw new Error(`booking refused: ${seat.reason}`);
    expect(await listCourseSeatsInTraining(db, shop.id, [seat.personId])).toEqual([]);
  });

  it("never reads another shop's course seats for this shop's divers", async () => {
    const { db, shop } = ctx;
    const session = await courseWith(db, shop.id, {
      title: "Rescue Weekend",
      sourceTemplateSlug: null,
      certifiesLevel: "rescue",
    });
    const seat = await book(db, shop.id, session.id, { name: "Noor Haddad" });
    if (!seat.ok) throw new Error(`booking refused: ${seat.reason}`);
    expect(
      await listCourseSeatsInTraining(db, "00000000-0000-0000-0000-000000000000", [seat.personId]),
    ).toEqual([]);
  });
});

describe("inTrainingBefore", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");
  const trip = { id: "fun", startsAt: new Date("2026-10-10T13:00:00.000Z") };
  const seat = (finishesAt: string, tripId = "course") => ({
    personId: "p",
    tripId,
    level: "open_water" as const,
    finishesAt: new Date(finishesAt),
  });

  it("counts a course that is still ahead and ends before the trip", () => {
    expect(inTrainingBefore([seat("2026-10-09T17:00:00.000Z")], trip, now)).toHaveLength(1);
  });

  it("stops counting a course that has already ended, at the sale as at the rail", () => {
    // A student who sat two days in May and quit is not in training in October.
    expect(inTrainingBefore([seat("2026-05-12T17:00:00.000Z")], trip, now)).toEqual([]);
  });

  it("ignores a course that ends after the trip, and the trip itself", () => {
    expect(
      inTrainingBefore(
        [seat("2026-10-11T17:00:00.000Z"), seat("2026-10-09T17:00:00.000Z", "fun")],
        trip,
        now,
      ),
    ).toEqual([]);
  });
});
