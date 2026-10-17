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
import { bookings, certifications, courses, tripAssignments, tripRequirements } from "./schema";
import { trainingMarksForRoster } from "./training-marks";

/**
 * **A marked training dive takes the course's own minimum level when the
 * course's instructor is aboard** (issue #2731, decided by Aaron 2026-10-17).
 * The charter here asks Advanced; the student holds a verified Open Water card
 * and is enrolled on a course whose own minimum is Open Water. Only a mark that
 * stands counts, and only with someone who teaches the session rostered on the
 * charter as its instructor.
 */
const fileCtx = fileScopedShopContext();

async function advancedCharter(): Promise<CharterContext> {
  const ctx = await charterContextFor(fileCtx);
  await ctx.db
    .update(tripRequirements)
    .set({ minimumCertificationLevel: "advanced_open_water" })
    .where(eq(tripRequirements.tripId, ctx.charter.id));
  await ctx.db
    .update(courses)
    .set({ minimumCertificationLevel: "open_water" })
    .where(eq(courses.id, ctx.course.courseId));
  await ctx.db.delete(certifications).where(eq(certifications.personId, ctx.course.personId));
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

async function roster(ctx: CharterContext, tripId: string, personId: string, tripRole: Role) {
  await ctx.db
    .delete(tripAssignments)
    .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, personId)));
  await ctx.db
    .insert(tripAssignments)
    .values({ tripId, personId, tripRole, assignedByPersonId: ctx.owner });
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
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
  });

  it("takes the course's own minimum when the mark stands and the course's instructor is aboard", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    expect(await markSeat(ctx)).toMatchObject({ ok: true });
    expect(await levelCodes(ctx)).toEqual([]);
    expect(await rosterWarning(ctx)).toBe(true);
  });

  it("still asks the course's own minimum: a student below it stays blocked", async () => {
    const ctx = await advancedCharter();
    await ctx.db
      .update(certifications)
      .set({ status: "pending" })
      .where(eq(certifications.personId, ctx.course.personId));
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_pending"]);
  });

  it("keeps the charter's level and warns when no instructor is aboard", async () => {
    const ctx = await advancedCharter();
    await roster(ctx, ctx.course.tripId, ctx.instructor, "instructor");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
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
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
    expect(await rosterWarning(ctx)).toBe(false);
  });

  it("keeps the charter's level when the session's instructor is aboard as the captain", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx, "captain");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
  });

  it("keeps the charter's level when the instructor is aboard only as a divemaster", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx, "divemaster");
    await markSeat(ctx);
    expect(await levelCodes(ctx)).toEqual(["certification_insufficient"]);
  });

  it("changes nothing on a mark that no longer stands", async () => {
    const ctx = await advancedCharter();
    await teachesAndAboard(ctx);
    await markSeat(ctx);
    await cancelBooking(ctx.db, ctx.shop.id, ctx.course.bookingId);
    const codes = await seatBlockerCodes(ctx);
    expect(codes).toContain("training_mark_invalid");
    expect(codes).toContain("certification_insufficient");
  });

  describe("admission never refuses the seat readiness would clear", () => {
    it("sells the charter seat to the enrolled student while the course's instructor is aboard", async () => {
      const ctx = await advancedCharter();
      await teachesAndAboard(ctx);
      // A second seat for the same student, so the charter's own seat in the
      // fixture does not answer `already_booked`.
      await cancelBooking(ctx.db, ctx.shop.id, ctx.seat.id);
      expect(
        await createBooking(ctx.db, {
          actor: "staff",
          shopId: ctx.shop.id,
          tripId: ctx.charter.id,
          personId: ctx.course.personId,
        }),
      ).toMatchObject({ ok: true });
    });

    it("refuses the same student with no instructor of the course aboard", async () => {
      const ctx = await advancedCharter();
      await roster(ctx, ctx.course.tripId, ctx.instructor, "instructor");
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
      const ctx = await advancedCharter();
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
