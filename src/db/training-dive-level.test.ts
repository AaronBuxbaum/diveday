import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  type CharterContext,
  charterContext as charterContextFor,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { cancelBooking, createBooking } from "./bookings";
import { createDiver } from "./divers";
import {
  bookings,
  certifications,
  courses,
  diveSites,
  rollCallCrewEvents,
  tripAssignments,
  tripDives,
  tripRequirements,
  trips,
} from "./schema";
import { seatWithinRoom, trainingDiveRoom } from "./training-mark-resolve";
import { trainingMarksForRoster } from "./training-marks";

/**
 * **A marked training dive takes the course's own minimum level when the
 * course's instructor is aboard** (issue #2731, decided by Aaron 2026-10-17;
 * domain review 2026-10-17). The charter here asks Advanced; the student holds
 * a verified Open Water card and is enrolled on an Advanced course whose own
 * minimum is Open Water. Only a mark that stands counts, only as far down as
 * the course certifies, never for an intro session, and only with someone who
 * teaches the session rostered on the charter as its instructor by somebody
 * else and not counted off it at the dock.
 */
const fileCtx = fileScopedShopContext();

/**
 * The charter asks Open Water and the student holds no card; they are enrolled
 * on a PADI Open Water course (no minimum, certifies Open Water), so a marked
 * dive asks them no card at all. The course keeps its ratio.
 */
async function advancedCharter(): Promise<CharterContext> {
  const ctx = await charterContextFor(fileCtx);
  await ctx.db
    .update(tripRequirements)
    .set({ minimumCertificationLevel: "open_water" })
    .where(eq(tripRequirements.tripId, ctx.charter.id));
  await ctx.db
    .update(courses)
    .set({
      minimumCertificationLevel: null,
      certifiesLevel: "open_water",
      isIntroCourse: false,
      agency: "padi",
    })
    .where(eq(courses.id, ctx.course.courseId));
  await ctx.db.delete(certifications).where(eq(certifications.personId, ctx.course.personId));
  return ctx;
}

/**
 * The charter asks Advanced; the student holds a verified Open Water card and
 * is enrolled on an Advanced course whose own minimum is Open Water. No ratio
 * is known for such a course, so its marked dives keep the charter's level.
 */
async function continuingEdCharter(): Promise<CharterContext> {
  const ctx = await advancedCharter();
  await ctx.db
    .update(tripRequirements)
    .set({ minimumCertificationLevel: "advanced_open_water" })
    .where(eq(tripRequirements.tripId, ctx.charter.id));
  await ctx.db
    .update(courses)
    .set({ minimumCertificationLevel: "open_water", certifiesLevel: "advanced_open_water" })
    .where(eq(courses.id, ctx.course.courseId));
  await ctx.db.insert(certifications).values({
    shopId: ctx.shop.id,
    personId: ctx.course.personId,
    agency: "padi",
    level: "open_water",
    identifier: "OW-2731",
    status: "verified",
  });
  return ctx;
}

type Role = "instructor" | "divemaster" | "captain";

async function roster(
  ctx: CharterContext,
  tripId: string,
  personId: string,
  tripRole: Role,
  assignedByPersonId: string = ctx.owner,
) {
  await ctx.db
    .delete(tripAssignments)
    .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, personId)));
  await ctx.db.insert(tripAssignments).values({ tripId, personId, tripRole, assignedByPersonId });
}

/** The session's instructor, rostered as its instructor on both the session and the charter. */
async function teachesAndAboard(ctx: CharterContext, charterRole: Role = "instructor") {
  await roster(ctx, ctx.course.tripId, ctx.instructor, "instructor");
  await roster(ctx, ctx.charter.id, ctx.instructor, charterRole);
}

const levelCodes = async (ctx: CharterContext) =>
  (await seatBlockerCodes(ctx)).filter((code) => code.startsWith("certification_"));

async function rosterWarning(ctx: CharterContext) {
  const [seat] = await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.seat.id));
  if (!seat) throw new Error("seat missing");
  const read = await trainingMarksForRoster(ctx.db, ctx.shop.id, ctx.charter, [
    {
      bookingId: seat.id,
      personId: seat.personId,
      participantType: seat.participantType,
      status: seat.status,
      identityHeld: seat.identityUnconfirmedAt !== null,
      trainingEnrollmentBookingId: seat.trainingEnrollmentBookingId,
      trainingMarkedAt: seat.trainingMarkedAt,
      trainingMarkedByPersonId: seat.trainingMarkedByPersonId,
      trainingClearedAt: seat.trainingClearedAt,
      trainingClearedByPersonId: seat.trainingClearedByPersonId,
      trainingClearedReason: seat.trainingClearedReason,
    },
  ]);
  return read.bySeat.get(ctx.seat.id)?.mark?.courseInstructorAboard;
}

describe("a marked training dive's level (issue #2731, in-memory PGlite)", () => {
  it("holds the unmarked seat to the charter's level, instructor aboard or not", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("keeps an explicit charter level even when the mark stands and the instructor is aboard", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(true);
  });

  it("does not apply a seat-level training mark to both dives on a two-site charter", async () => {
    const ctx = await advancedCharter();
    await ctx.db
      .update(tripRequirements)
      .set({ minimumCertificationLevel: null })
      .where(eq(tripRequirements.tripId, ctx.charter.id));
    const sites = await ctx.db
      .insert(diveSites)
      .values([
        {
          shopId: ctx.shop.id,
          name: "Training site A",
          slug: "training-site-a",
          minimumCertificationLevel: "open_water",
        },
        {
          shopId: ctx.shop.id,
          name: "Training site B",
          slug: "training-site-b",
          minimumCertificationLevel: "open_water",
        },
      ])
      .returning();
    if (!sites[0] || !sites[1]) throw new Error("test sites missing");
    await ctx.db.insert(tripDives).values(
      sites.map((site, index) => ({
        tripId: ctx.charter.id,
        diveNumber: index + 1,
        diveSiteId: site.id,
      })),
    );
    await teachesAndAboard(ctx);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    await ctx.db
      .delete(tripDives)
      .where(and(eq(tripDives.tripId, ctx.charter.id), eq(tripDives.diveNumber, 2)));
    await ctx.db
      .update(trips)
      .set({ plannedDives: 1, diveSiteId: sites[1].id })
      .where(eq(trips.id, ctx.charter.id));
    // One dive but two distinct visited-site sources still cannot identify the site.
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    await ctx.db.update(trips).set({ diveSiteId: sites[0].id }).where(eq(trips.id, ctx.charter.id));
    expect(await levelCodes(ctx)).toEqual([]);
  });

  it("keeps the charter's level and warns when no instructor is aboard", async () => {
    const ctx = await advancedCharter();
    await roster(ctx, ctx.course.tripId, ctx.instructor, "instructor");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("keeps the charter's level when the instructor aboard does not teach the session", async () => {
    const ctx = await advancedCharter();
    await roster(ctx, ctx.charter.id, ctx.instructor, "instructor");
    await ctx.db
      .delete(tripAssignments)
      .where(
        and(
          eq(tripAssignments.tripId, ctx.course.tripId),
          eq(tripAssignments.personId, ctx.instructor),
        ),
      );
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("keeps the charter's level when the session's instructor is aboard as the captain", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx, "captain");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("keeps the charter's level when the instructor is aboard only as a divemaster", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx, "divemaster");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it("never lowers a level above what the course certifies", async () => {
    const ctx = await advancedCharter();
    await ctx.db
      .update(tripRequirements)
      .set({ minimumCertificationLevel: "advanced_open_water" })
      .where(eq(tripRequirements.tripId, ctx.charter.id));
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
  });

  it.each([
    ["an intro session", { isIntroCourse: true }, true],
    ["a course that certifies no level", { certifiesLevel: null }, true],
    // No ratio is known for these, so the level is never lowered (fail closed).
    ["another agency's course", { agency: "SSI" }, false],
  ] as const)("never lowers the level for %s", async (_name, course, aboard) => {
    const ctx = await advancedCharter();
    await ctx.db.update(courses).set(course).where(eq(courses.id, ctx.course.courseId));
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(aboard);
  });

  it("never lowers the level for a continuing-education course: no ratio is known for it", async () => {
    const ctx = await continuingEdCharter();
    await teachesAndAboard(ctx);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("ignores an instructor who rostered themself on the charter", async () => {
    const ctx = await advancedCharter();
    await roster(ctx, ctx.course.tripId, ctx.instructor, "instructor");
    await roster(ctx, ctx.charter.id, ctx.instructor, "instructor", ctx.instructor);
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("ignores an instructor the crew count marked not aboard", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    await ctx.db.insert(rollCallCrewEvents).values({
      shopId: ctx.shop.id,
      tripId: ctx.charter.id,
      personId: ctx.instructor,
      recordedByPersonId: ctx.owner,
      status: "not_boarded",
      checkpoint: "departure",
      occurredAt: ctx.now,
    });
    expect(await levelCodes(ctx)).toEqual(["certification_missing"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("has room for a marked dive only where the course has a known ratio and an instructor is aboard", async () => {
    const ctx = await advancedCharter();
    const pair = (
      course: Partial<{ minimumLevel: "open_water" | null; intro: boolean; agency: string }>,
    ) => ({
      departureTripId: ctx.charter.id,
      sessionTripId: ctx.course.tripId,
      course: {
        minimumLevel: null,
        certifiesLevel: null,
        intro: false,
        agency: "padi",
        ...course,
      },
    });
    const key = `${ctx.charter.id}:${ctx.course.tripId}`;
    const spare = async (p: ReturnType<typeof pair>) =>
      (await trainingDiveRoom(ctx.db, ctx.shop.id, [p])).get(key)?.spare;
    expect(await spare(pair({}))).toBe(false);
    await teachesAndAboard(ctx);
    expect(await spare(pair({}))).toBe(true);
    expect(await spare(pair({ intro: true }))).toBe(true);
    expect(await spare(pair({ minimumLevel: "open_water" }))).toBe(false);
    expect(await spare(pair({ agency: "NAUI" }))).toBe(false);
    expect(seatWithinRoom(undefined, "a")).toBe(false);
    expect(
      seatWithinRoom({ seated: new Set(["a"]), overRatio: new Set(), spare: false }, "a"),
    ).toBe(true);
    expect(
      seatWithinRoom({ seated: new Set(["a"]), overRatio: new Set(), spare: false }, "b"),
    ).toBe(false);
  });

  it("stops seating marks once the instructor's ratio is used up, even with a second mark on another seat", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await rosterWarning(ctx)).toBe(true);
    // Eight other marked seats of the same session fill the instructor's 8.
    const others = [];
    for (let i = 0; i < 8; i += 1) {
      const diver = await createDiver(ctx.db, {
        shopId: ctx.shop.id,
        fullName: `Ratio Diver ${i}`,
        email: `ratio-${i}-2731@example.com`,
      });
      if (!diver) throw new Error("diver setup failed");
      others.push(diver.id);
    }
    const marks = [];
    for (const personId of others) {
      const [row] = await ctx.db
        .insert(bookings)
        .values({
          bookedAs: "diver",
          shopId: ctx.shop.id,
          tripId: ctx.charter.id,
          personId,
          trainingEnrollmentBookingId: ctx.course.bookingId,
          trainingMarkedAt: new Date(ctx.now.getTime() - 60_000),
          trainingMarkedByPersonId: ctx.owner,
        })
        .returning({ id: bookings.id });
      if (row) marks.push(row.id);
    }
    expect(marks).toHaveLength(8);
    // The earlier eight take the room; the ninth (the fixture's seat) is out.
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("changes nothing on a mark that no longer stands", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    await cancelBooking(ctx.db, ctx.shop.id, ctx.course.bookingId);
    const codes = await seatBlockerCodes(ctx);
    expect(codes).toContain("training_mark_invalid");
    expect(codes).toContain("certification_missing");
  });

  describe("admission agrees with readiness", () => {
    it("refuses the enrolled student whether or not the course's instructor is aboard: no ratio is known", async () => {
      const ctx = await continuingEdCharter();
      await teachesAndAboard(ctx);
      await cancelBooking(ctx.db, ctx.shop.id, ctx.seat.id);
      expect(
        await createBooking(ctx.db, {
          actor: "staff",
          shopId: ctx.shop.id,
          tripId: ctx.charter.id,
          personId: ctx.course.personId,
        }),
      ).toMatchObject({ ok: false, reason: "trip_prerequisite" });
    });

    it("refuses a carded Open Water diver with no enrollment, instructor aboard or not", async () => {
      const ctx = await continuingEdCharter();
      await teachesAndAboard(ctx);
      const stranger = await createDiver(ctx.db, {
        shopId: ctx.shop.id,
        fullName: "Odile Fins",
        email: "odile-2731@example.com",
      });
      if (!stranger) throw new Error("diver setup failed");
      await ctx.db.insert(certifications).values({
        shopId: ctx.shop.id,
        personId: stranger.id,
        agency: "padi",
        level: "open_water",
        identifier: "OW-ODILE",
        status: "verified",
      });
      expect(
        await createBooking(ctx.db, {
          actor: "staff",
          shopId: ctx.shop.id,
          tripId: ctx.charter.id,
          personId: stranger.id,
        }),
      ).toMatchObject({ ok: false, reason: "trip_prerequisite" });
    });
  });
});
