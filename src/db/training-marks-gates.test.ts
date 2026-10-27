import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  charterContext as charterContextFor,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { issueBookingCapability, revokeBookingCapabilities } from "./booking-capabilities";
import { cancelBooking, setBookingParticipantType } from "./bookings";
import { getCourseFormsForBooking, recordPaperCourseForm, signCourseForm } from "./course-forms";
import { subscribeManifestEvents } from "./manifest-events";
import { getTripManifest } from "./manifests";
import {
  activityEvents,
  bookings,
  courseFormRecords,
  courses,
  people,
  shops,
  tripAssignments,
  trips,
} from "./schema";
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
    // A course with a known ratio (PADI, no minimum); one without has no room.
    await ctx.db
      .update(courses)
      .set({ agency: "padi", minimumCertificationLevel: null, isIntroCourse: false })
      .where(eq(courses.id, ctx.course.courseId));
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
      intro: false,
      overRatio: false,
    });
    // Read from the crew at read time. An instructor who does not teach the
    // session is not the course's (issue #2731); once they teach it, they are,
    // rostered by somebody else (review 2026-10-17).
    const rostered = { personId: ctx.instructor, tripRole: "instructor" as const };
    await ctx.db
      .insert(tripAssignments)
      .values({ ...rostered, tripId: ctx.charter.id, assignedByPersonId: ctx.owner });
    expect((await row())?.trainingDive?.instructorAboard).toBe(false);
    await ctx.db
      .insert(tripAssignments)
      .values({ ...rostered, tripId: ctx.course.tripId, assignedByPersonId: ctx.owner });
    expect((await row())?.trainingDive?.instructorAboard).toBe(true);
    // A mark that no longer stands names no course.
    await cancelBooking(ctx.db, ctx.shop.id, ctx.course.bookingId);
    expect((await row())?.trainingDive ?? null).toBeNull();
  });

  describe("a cleared mark says why, and stays said", () => {
    type Ctx = Awaited<ReturnType<typeof charterContext>>;
    const clearAs = (ctx: Ctx, actorPersonId: string, now?: Date) =>
      clearTrainingDive(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        actorPersonId,
        now,
      });
    const seatRow = async (ctx: Ctx) =>
      (await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.seat.id)))[0];
    const sign = (ctx: Ctx) =>
      signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        formVersionId: ctx.form.versionId as string,
        signerName: ctx.course.fullName,
        agreed: true,
      });
    const holdEnrollment = (ctx: Ctx) =>
      ctx.db
        .update(bookings)
        .set({ identityUnconfirmedAt: ctx.now })
        .where(eq(bookings.id, ctx.course.bookingId));

    it("stamps forms_owed on a mark cleared with its forms unsigned", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(await clearAs(ctx, ctx.owner)).toEqual({ ok: true, changed: true });
      expect((await seatRow(ctx))?.trainingClearedReason).toBe("forms_owed");
    });

    it("reads a mark that no longer holds against the enrollment's own records", async () => {
      const signed = await charterContext();
      await markSeat(signed);
      expect(await sign(signed)).toMatchObject({ ok: true });
      await holdEnrollment(signed);
      expect(await seatBlockerCodes(signed)).toContain("training_mark_invalid");
      // Still a boarding block relaxed: not an instructor's call.
      expect(await clearAs(signed, signed.instructor)).toEqual({ ok: false, reason: "forms_owed" });
      expect(await clearAs(signed, signed.owner)).toEqual({ ok: true, changed: true });
      expect((await seatRow(signed))?.trainingClearedReason).toBe("mark_invalid");

      const unsigned = await charterContext();
      await markSeat(unsigned);
      await holdEnrollment(unsigned);
      expect(await clearAs(unsigned, unsigned.owner)).toEqual({ ok: true, changed: true });
      expect((await seatRow(unsigned))?.trainingClearedReason).toBe("forms_owed");
    });

    it("keeps an earlier clear's stamp through a re-mark, until a later clear replaces it", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      await clearAs(ctx, ctx.owner);
      expect(await markSeat(ctx)).toEqual({ ok: true, changed: true });
      expect(await seatRow(ctx)).toMatchObject({
        trainingClearedByPersonId: ctx.owner,
        trainingClearedReason: "forms_owed",
      });
      expect(await sign(ctx)).toMatchObject({ ok: true });
      expect(await clearAs(ctx, ctx.owner)).toEqual({ ok: true, changed: true });
      expect(await seatRow(ctx)).toMatchObject({
        trainingClearedAt: null,
        trainingClearedByPersonId: null,
        trainingClearedReason: null,
      });
    });

    it("refuses to clear a mark once the charter is home", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      const home = new Date(ctx.charter.endsAt.getTime() + 2 * 24 * 60 * 60 * 1000);
      expect(await clearAs(ctx, ctx.owner, home)).toEqual({
        ok: false,
        reason: "departure_over",
      });
      expect((await seatRow(ctx))?.trainingEnrollmentBookingId).toBe(ctx.course.bookingId);
    });

    it("drops the mark, logged, when the seat stops diving", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(
        await setBookingParticipantType(ctx.db, {
          shopId: ctx.shop.id,
          tripId: ctx.charter.id,
          bookingId: ctx.seat.id,
          to: "snorkeler",
          actorPersonId: ctx.owner,
        }),
      ).toMatchObject({ ok: true, changed: true });
      expect((await seatRow(ctx))?.trainingEnrollmentBookingId).toBeNull();
      expect(await seatBlockerCodes(ctx)).not.toContain("training_mark_invalid");
      const [line] = await ctx.db
        .select({ actor: activityEvents.actorPersonId })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.bookingId, ctx.seat.id),
            eq(activityEvents.code, "training_dive_cleared"),
          ),
        );
      expect(line?.actor).toBe(ctx.owner);
    });
  });

  describe("a signature from the charter seat's link", () => {
    type Ctx = Awaited<ReturnType<typeof charterContext>>;
    const signFrom = (ctx: Ctx, bookingId: string) =>
      signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId,
        formVersionId: ctx.form.versionId as string,
        signerName: ctx.course.fullName,
        agreed: true,
      });
    const recordFor = async (ctx: Ctx) =>
      (
        await ctx.db
          .select({ signedViaBookingId: courseFormRecords.signedViaBookingId })
          .from(courseFormRecords)
          .where(eq(courseFormRecords.formId, ctx.form.id))
      )[0];

    it("records the seat it was signed from, and nothing when signed on the course seat", async () => {
      const charter = await charterContext();
      await markSeat(charter);
      expect(await signFrom(charter, charter.seat.id)).toMatchObject({ ok: true });
      expect((await recordFor(charter))?.signedViaBookingId).toBe(charter.seat.id);

      const own = await charterContext();
      await markSeat(own);
      expect(await signFrom(own, own.course.bookingId)).toMatchObject({ ok: true });
      expect((await recordFor(own))?.signedViaBookingId).toBeNull();
    });

    it("is refused once the course seat's links were taken back after the mark", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      await issueBookingCapability(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.course.bookingId,
        purpose: "readiness",
      });
      await revokeBookingCapabilities(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.course.bookingId,
      });
      expect(await signFrom(ctx, ctx.seat.id)).toEqual({ ok: false, reason: "unavailable" });
      expect(await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.id)).toBeNull();
      // The course seat's own route is the shop's to reissue, and still signs.
      expect(await signFrom(ctx, ctx.course.bookingId)).toMatchObject({ ok: true });
    });
  });

  describe("a paper form recorded from the charter's row", () => {
    type Ctx = Awaited<ReturnType<typeof charterContext>>;
    const recordAs = (ctx: Ctx, recordedByPersonId: string) =>
      recordPaperCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        formId: ctx.form.id,
        recordedByPersonId,
        paperCopyConfirmed: true,
      });

    it("takes a forms manager, or the enrollment's instructor someone else rostered", async () => {
      const owner = await charterContext();
      await markSeat(owner);
      expect(await recordAs(owner, owner.owner)).toMatchObject({ ok: true });

      const instructor = await charterContext();
      await markSeat(instructor);
      await instructor.db.insert(tripAssignments).values({
        tripId: instructor.course.tripId,
        personId: instructor.instructor,
        tripRole: "instructor",
        assignedByPersonId: instructor.owner,
      });
      expect(await recordAs(instructor, instructor.instructor)).toMatchObject({ ok: true });
    });

    it("refuses a captain, and an instructor who does not teach the enrollment", async () => {
      const ctx = await charterContext();
      await markSeat(ctx);
      expect(await recordAs(ctx, ctx.captain)).toEqual({ ok: false, reason: "not_authorized" });
      expect(await recordAs(ctx, ctx.instructor)).toEqual({ ok: false, reason: "not_authorized" });
      expect(await seatBlockerCodes(ctx)).toContain("course_form_unsigned");
    });
  });

  it("refuses, in the database, a mark naming another shop's seat", async () => {
    const ctx = await charterContext();
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-training-mark", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("fixture insert failed");
    const [person] = await ctx.db
      .insert(people)
      .values({ shopId: other.id, fullName: ctx.course.fullName })
      .returning({ id: people.id });
    const [trip] = await ctx.db
      .insert(trips)
      .values({
        shopId: other.id,
        title: "Their course",
        startsAt: ctx.course.startsAt,
        endsAt: ctx.course.endsAt,
        capacity: 6,
      })
      .returning({ id: trips.id });
    if (!person || !trip) throw new Error("fixture insert failed");
    const [theirs] = await ctx.db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: other.id, tripId: trip.id, personId: person.id })
      .returning({ id: bookings.id });
    if (!theirs) throw new Error("fixture insert failed");
    await expect(
      ctx.db.transaction((tx) =>
        tx
          .update(bookings)
          .set({
            trainingEnrollmentBookingId: theirs.id,
            trainingMarkedAt: ctx.now,
            trainingMarkedByPersonId: ctx.owner,
          })
          .where(eq(bookings.id, ctx.seat.id)),
      ),
    ).rejects.toThrow();
  });
});
