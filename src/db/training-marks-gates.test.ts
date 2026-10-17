import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  charterContext as charterContextFor,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { cancelBooking } from "./bookings";
import { recordPaperCourseForm, signCourseForm } from "./course-forms";
import { subscribeManifestEvents } from "./manifest-events";
import { getTripManifest } from "./manifests";
import { bookings, courses, people, tripAssignments } from "./schema";
import { clearTrainingDive } from "./training-marks";
import { changeTripCrew } from "./trips-crew";
import { moveTrip } from "./trips-schedule";

// The review round on #2275's build: each gate a reviewer found open.
const fileCtx = fileScopedShopContext();
const charterContext = () => charterContextFor(fileCtx);

describe("training marks — the gates the build review closed (in-memory PGlite)", () => {
  describe("uses one minor flag for both seats", () => {
    it("asks a guardian when only the charter seat says Under 18", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      await ctx.db
        .update(people)
        .set({ dateOfBirth: null })
        .where(eq(people.id, ctx.course.personId));
      await ctx.db
        .update(bookings)
        .set({ minorDeclaredAt: ctx.now })
        .where(eq(bookings.id, ctx.seat.id));
      expect(
        await signCourseForm(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          formVersionId: ctx.form.versionId as string,
          signerName: ctx.course.fullName,
          agreed: true,
        }),
      ).toEqual({ ok: false, reason: "guardian_required" });
      expect(await seatBlockerCodes(ctx)).toContain("course_form_unsigned");
    });

    it("owes the guardian on the charter seat when only the course seat says Under 18", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      await ctx.db
        .update(people)
        .set({ dateOfBirth: null })
        .where(eq(people.id, ctx.course.personId));
      expect(
        await signCourseForm(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          formVersionId: ctx.form.versionId as string,
          signerName: ctx.course.fullName,
          agreed: true,
        }),
      ).toMatchObject({ ok: true });
      await ctx.db
        .update(bookings)
        .set({ minorDeclaredAt: ctx.now })
        .where(eq(bookings.id, ctx.course.bookingId));
      expect(await seatBlockerCodes(ctx)).toContain("course_form_guardian_missing");
    });
  });

  describe("clearing with forms owed takes an instructor someone else rostered", () => {
    type Ctx = Awaited<ReturnType<typeof charterContext>>;
    const roster = (ctx: Ctx, actor: string, tripRole: "instructor") =>
      changeTripCrew(
        ctx.db,
        ctx.shop.id,
        ctx.course.tripId,
        { personId: ctx.instructor, operation: "assign", tripRole },
        { actorPersonId: actor },
      );
    const clear = (ctx: Ctx) =>
      clearTrainingDive(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        actorPersonId: ctx.instructor,
      });

    it("refuses an instructor who put themselves on the session", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(await roster(ctx, ctx.instructor, "instructor")).toBe(true);
      expect(await clear(ctx)).toEqual({ ok: false, reason: "forms_owed" });
      expect(await seatBlockerCodes(ctx)).toContain("course_form_unsigned");
    });

    it("refuses an instructor who made themselves the session's instructor", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      // Rostered by the owner as the divemaster, written straight in: the
      // course rules would refuse a session left with no instructor.
      await ctx.db.insert(tripAssignments).values({
        tripId: ctx.course.tripId,
        personId: ctx.instructor,
        tripRole: "divemaster",
        assignedByPersonId: ctx.owner,
      });
      expect(await roster(ctx, ctx.instructor, "instructor")).toBe(true);
      expect(await clear(ctx)).toEqual({ ok: false, reason: "forms_owed" });
    });

    it("takes an instructor the owner rostered", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(await roster(ctx, ctx.owner, "instructor")).toBe(true);
      expect(await clear(ctx)).toEqual({ ok: true, changed: true });
    });
  });

  describe("tells the charter's manifest when the enrollment behind its mark changes", () => {
    type Ctx = Awaited<ReturnType<typeof charterContext>>;
    async function charterEvents(ctx: Ctx, act: () => Promise<unknown>) {
      let events = 0;
      const stop = subscribeManifestEvents(ctx.shop.id, ctx.charter.id, () => {
        events += 1;
      });
      try {
        await act();
      } finally {
        stop();
      }
      return events;
    }

    it("when the course seat is canceled", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(
        await charterEvents(ctx, () => cancelBooking(ctx.db, ctx.shop.id, ctx.course.bookingId)),
      ).toBeGreaterThan(0);
    });

    it("when the session moves", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(
        await charterEvents(ctx, async () =>
          expect(
            await moveTrip(
              ctx.db,
              ctx.shop.id,
              ctx.course.tripId,
              new Date(ctx.course.startsAt.getTime() - 2 * 60 * 60 * 1000),
              { actorPersonId: ctx.owner },
            ),
          ).toMatchObject({ ok: true }),
        ),
      ).toBeGreaterThan(0);
    });

    it("when a form is signed or recorded on paper", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(
        await charterEvents(ctx, () =>
          signCourseForm(ctx.db, {
            shopId: ctx.shop.id,
            bookingId: ctx.course.bookingId,
            formVersionId: ctx.form.versionId as string,
            signerName: ctx.course.fullName,
            agreed: true,
          }),
        ),
      ).toBeGreaterThan(0);
      const other = await charterContext();
      await markSeat(other);
      expect(
        await charterEvents(other, () =>
          recordPaperCourseForm(other.db, {
            shopId: other.shop.id,
            bookingId: other.course.bookingId,
            formId: other.form.id,
            recordedByPersonId: other.owner,
            paperCopyConfirmed: true,
          }),
        ),
      ).toBeGreaterThan(0);
    });
  });

  it("prints the course a marked dive counts toward on the manifest, and that no instructor is aboard", async () => {
    const ctx = await charterContext();
    await markSeat(ctx);
    const row = async () =>
      (await getTripManifest(ctx.db, ctx.shop.id, ctx.charter.id))?.divers.find(
        (diver) => diver.bookingId === ctx.seat.id,
      );
    const [course] = await ctx.db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, ctx.course.courseId));
    expect((await row())?.trainingDive).toEqual({
      courseTitle: course?.title,
      instructorAboard: false,
    });
    // Read from the crew at read time: rostering one clears the warning.
    await ctx.db
      .insert(tripAssignments)
      .values({ tripId: ctx.charter.id, personId: ctx.instructor, tripRole: "instructor" });
    expect((await row())?.trainingDive?.instructorAboard).toBe(true);
    // A mark that no longer stands names no course.
    await cancelBooking(ctx.db, ctx.shop.id, ctx.course.bookingId);
    expect((await row())?.trainingDive ?? null).toBeNull();
  });
});
