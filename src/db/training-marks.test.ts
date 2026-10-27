import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  charterContext as charterContextFor,
  HOUR,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { getCourseFormsForBooking, recordPaperCourseForm, signCourseForm } from "./course-forms";
import { getTripManifest } from "./manifests";
import { getBookingReadiness } from "./readiness";
import {
  activityEvents,
  bookings,
  courseFormRecords,
  courses,
  people,
  tripAssignments,
  trips,
} from "./schema";
import { clearTrainingDive, markTrainingDive, trainingMarksForRoster } from "./training-marks";

// One seeded database for the file and a rolled-back transaction per test.
const fileCtx = fileScopedShopContext();
const charterContext = () => charterContextFor(fileCtx);
const mark = markSeat;
const codes = seatBlockerCodes;

describe("training marks — a training dive on a charter (in-memory PGlite)", () => {
  it("asks an unmarked charter seat nothing: never an inference from the open enrollment", async () => {
    const ctx = await charterContext();
    expect(await codes(ctx)).not.toContain("course_form_unsigned");
    expect((await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.id))?.required).toEqual(
      [],
    );
  });

  it("asks a marked seat the enrollment's forms, and logs who marked it", async () => {
    const ctx = await charterContext();
    expect(await mark(ctx)).toEqual({ ok: true, changed: true });
    expect(await codes(ctx)).toContain("course_form_unsigned");
    const forms = await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.id);
    expect(forms?.enrollment.bookingId).toBe(ctx.course.bookingId);
    expect(forms?.outstanding.map((form) => form.formId)).toEqual([ctx.form.id]);
    const [line] = await ctx.db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, ctx.seat.id),
          eq(activityEvents.code, "training_dive_marked"),
        ),
      );
    expect(line?.actorPersonId).toBe(ctx.owner);
    expect(line?.tripId).toBe(ctx.charter.id);
  });

  it("writes a signature from the charter seat onto the enrollment, which clears both seats", async () => {
    const ctx = await charterContext();
    await mark(ctx);
    const signed = await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.id,
      formVersionId: ctx.form.versionId as string,
      signerName: ctx.course.fullName,
      agreed: true,
    });
    expect(signed).toMatchObject({ ok: true, alreadySigned: false });
    const records = await ctx.db
      .select({ bookingId: courseFormRecords.bookingId, tripId: courseFormRecords.tripId })
      .from(courseFormRecords)
      .where(eq(courseFormRecords.personId, ctx.course.personId));
    expect(records).toEqual([{ bookingId: ctx.course.bookingId, tripId: ctx.course.tripId }]);
    expect(await codes(ctx)).not.toContain("course_form_unsigned");
    const enrollment = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.course.bookingId);
    expect(enrollment?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
    // Signed once per enrollment: the course seat's own page asks nothing more.
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.course.bookingId))?.outstanding,
    ).toEqual([]);
  });

  it("records a paper form from the charter's row against the enrollment", async () => {
    const ctx = await charterContext();
    await mark(ctx);
    const recorded = await recordPaperCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.id,
      formId: ctx.form.id,
      recordedByPersonId: ctx.owner,
      paperCopyConfirmed: true,
    });
    expect(recorded).toMatchObject({ ok: true });
    const [record] = await ctx.db
      .select({ bookingId: courseFormRecords.bookingId })
      .from(courseFormRecords)
      .where(eq(courseFormRecords.personId, ctx.course.personId));
    expect(record?.bookingId).toBe(ctx.course.bookingId);
    expect(await codes(ctx)).not.toContain("course_form_unsigned");
  });

  it("asks a minor's guardian on the charter seat, as on the course seat", async () => {
    const ctx = await charterContext();
    await mark(ctx);
    await ctx.db
      .update(people)
      .set({ dateOfBirth: "2014-01-01" })
      .where(eq(people.id, ctx.course.personId));
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        formVersionId: ctx.form.versionId as string,
        signerName: ctx.course.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });
    expect(await codes(ctx)).toContain("course_form_unsigned");
  });

  describe("refuses a mark that would not stand", () => {
    it("on another person's course seat", async () => {
      const ctx = await charterContext();
      const [other] = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(eq(bookings.tripId, ctx.course.tripId), ne(bookings.personId, ctx.course.personId)),
        )
        .limit(1);
      if (!other) throw new Error("course session has one seat only");
      expect(await mark(ctx, { enrollmentBookingId: other.id })).toEqual({
        ok: false,
        reason: "enrollment_other_person",
      });
    });

    it("on an id that is no seat of this shop", async () => {
      const ctx = await charterContext();
      expect(await mark(ctx, { enrollmentBookingId: randomUUID() })).toEqual({
        ok: false,
        reason: "enrollment_missing",
      });
    });

    it("on a canceled, a held, or a non-diving course seat", async () => {
      const ctx = await charterContext();
      await ctx.db
        .update(bookings)
        .set({ status: "cancelled" })
        .where(eq(bookings.id, ctx.course.bookingId));
      expect(await mark(ctx)).toEqual({ ok: false, reason: "enrollment_canceled" });
      await ctx.db
        .update(bookings)
        .set({ status: "booked", identityUnconfirmedAt: ctx.now })
        .where(eq(bookings.id, ctx.course.bookingId));
      expect(await mark(ctx)).toEqual({ ok: false, reason: "enrollment_held" });
    });

    it("on a session that ends before the charter leaves", async () => {
      const ctx = await charterContext();
      await ctx.db
        .update(trips)
        .set({
          startsAt: new Date(ctx.charter.startsAt.getTime() - 4 * HOUR),
          endsAt: new Date(ctx.charter.startsAt.getTime() - HOUR),
          revision: 2,
        })
        .where(eq(trips.id, ctx.course.tripId));
      expect(await mark(ctx)).toEqual({ ok: false, reason: "ends_before_departure" });
    });

    it("on a seat that is not on a course session, or from a seat that is", async () => {
      const ctx = await charterContext();
      const [second] = await ctx.db
        .insert(trips)
        .values({
          shopId: ctx.shop.id,
          title: "Night dive",
          startsAt: ctx.charter.startsAt,
          endsAt: ctx.charter.endsAt,
          capacity: 6,
        })
        .returning();
      if (!second) throw new Error("second charter insert failed");
      const [other] = await ctx.db
        .insert(bookings)
        .values({
          bookedAs: "diver",
          shopId: ctx.shop.id,
          tripId: second.id,
          personId: ctx.course.personId,
        })
        .returning();
      if (!other) throw new Error("second charter seat insert failed");
      expect(await mark(ctx, { enrollmentBookingId: other.id })).toEqual({
        ok: false,
        reason: "not_a_course_session",
      });
      expect(
        await markTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.course.bookingId,
          enrollmentBookingId: ctx.course.bookingId,
          actorPersonId: ctx.owner,
        }),
      ).toEqual({ ok: false, reason: "seat_on_course_session" });
    });

    it("from a held charter seat, or a snorkeler's", async () => {
      const ctx = await charterContext();
      await ctx.db
        .update(bookings)
        .set({ identityUnconfirmedAt: ctx.now })
        .where(eq(bookings.id, ctx.seat.id));
      expect(await mark(ctx)).toEqual({ ok: false, reason: "seat_held" });
      await ctx.db
        .update(bookings)
        .set({ identityUnconfirmedAt: null, participantType: "snorkeler" })
        .where(eq(bookings.id, ctx.seat.id));
      expect(await mark(ctx)).toEqual({ ok: false, reason: "seat_not_diving" });
    });

    it("from a captain: marking is owner, manager or instructor work", async () => {
      const ctx = await charterContext();
      expect(await mark(ctx, { actorPersonId: ctx.captain })).toEqual({
        ok: false,
        reason: "not_authorized",
      });
      expect(await codes(ctx)).not.toContain("course_form_unsigned");
    });

    it("a second enrollment on a marked seat, and takes the same one twice as no change", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      expect(await mark(ctx)).toEqual({ ok: true, changed: false });
      expect(await mark(ctx, { enrollmentBookingId: randomUUID() })).toEqual({
        ok: false,
        reason: "already_marked",
      });
    });
  });

  it("raises training_mark_invalid once the enrollment is canceled, and signs nothing against it", async () => {
    const ctx = await charterContext();
    await mark(ctx);
    await ctx.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, ctx.course.bookingId));
    const blockers = await codes(ctx);
    expect(blockers).toContain("training_mark_invalid");
    expect(blockers).not.toContain("course_form_unsigned");
    expect(await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.id)).toBeNull();
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        formVersionId: ctx.form.versionId as string,
        signerName: ctx.course.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("raises training_mark_invalid when the session moves to end before the charter", async () => {
    const ctx = await charterContext();
    await mark(ctx);
    await ctx.db
      .update(trips)
      .set({
        startsAt: new Date(ctx.charter.startsAt.getTime() - 4 * HOUR),
        endsAt: new Date(ctx.charter.startsAt.getTime() - HOUR),
        revision: 2,
      })
      .where(eq(trips.id, ctx.course.tripId));
    expect(await codes(ctx)).toContain("training_mark_invalid");
  });

  describe("clearing a mark", () => {
    it("with forms owed, refuses an instructor who does not teach the enrollment", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.instructor,
        }),
      ).toEqual({ ok: false, reason: "forms_owed" });
      expect(await codes(ctx)).toContain("course_form_unsigned");
    });

    it("with forms owed, takes the enrollment's rostered instructor and stamps who cleared it", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      await ctx.db.insert(tripAssignments).values({
        tripId: ctx.course.tripId,
        personId: ctx.instructor,
        tripRole: "instructor",
        assignedByPersonId: ctx.owner,
      });
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.instructor,
        }),
      ).toEqual({ ok: true, changed: true });
      const [row] = await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.seat.id));
      expect(row?.trainingEnrollmentBookingId).toBeNull();
      expect(row?.trainingClearedByPersonId).toBe(ctx.instructor);
      expect(await codes(ctx)).not.toContain("course_form_unsigned");
    });

    it("with forms owed, takes an owner, and an invalid mark counts as owed", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      await ctx.db
        .update(bookings)
        .set({ status: "cancelled" })
        .where(eq(bookings.id, ctx.course.bookingId));
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.instructor,
        }),
      ).toEqual({ ok: false, reason: "forms_owed" });
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.owner,
        }),
      ).toEqual({ ok: true, changed: true });
      expect(await codes(ctx)).not.toContain("training_mark_invalid");
      const [line] = await ctx.db
        .select({ params: activityEvents.params })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.bookingId, ctx.seat.id),
            eq(activityEvents.code, "training_dive_cleared"),
          ),
        );
      expect(line?.params.formsOwed).toBe("yes");
    });

    it("with every form signed, takes any instructor and stamps nothing", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        formVersionId: ctx.form.versionId as string,
        signerName: ctx.course.fullName,
        agreed: true,
      });
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.instructor,
        }),
      ).toEqual({ ok: true, changed: true });
      const [row] = await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.seat.id));
      expect(row?.trainingClearedAt).toBeNull();
    });

    it("refuses a captain whatever is owed", async () => {
      const ctx = await charterContext();
      await mark(ctx);
      expect(
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.captain,
        }),
      ).toEqual({ ok: false, reason: "not_authorized" });
    });
  });

  it("holds the mark's three columns together", async () => {
    const ctx = await charterContext();
    await expect(
      ctx.db
        .update(bookings)
        .set({ trainingEnrollmentBookingId: ctx.course.bookingId })
        .where(eq(bookings.id, ctx.seat.id)),
    ).rejects.toThrow();
  });

  it("offers the roster the diver's course seat, then shows the mark and that no instructor is aboard", async () => {
    // A known introductory course is carried to both readers without assuming a group.
    const ctx = await charterContext();
    const seatInput = async () => {
      const [row] = await ctx.db.select().from(bookings).where(eq(bookings.id, ctx.seat.id));
      if (!row) throw new Error("seat missing");
      return {
        bookingId: row.id,
        personId: row.personId,
        participantType: row.participantType,
        status: row.status,
        identityHeld: row.identityUnconfirmedAt !== null,
        trainingEnrollmentBookingId: row.trainingEnrollmentBookingId,
        trainingMarkedAt: row.trainingMarkedAt,
        trainingMarkedByPersonId: row.trainingMarkedByPersonId,
        trainingClearedAt: row.trainingClearedAt,
        trainingClearedByPersonId: row.trainingClearedByPersonId,
        trainingClearedReason: row.trainingClearedReason,
      };
    };
    const before = await trainingMarksForRoster(ctx.db, ctx.shop.id, ctx.charter, [
      await seatInput(),
    ]);
    expect(before.bySeat.get(ctx.seat.id)?.options.map((o) => o.enrollmentBookingId)).toEqual([
      ctx.course.bookingId,
    ]);
    await ctx.db
      .update(courses)
      .set({ isIntroCourse: true })
      .where(eq(courses.id, ctx.course.courseId));
    await mark(ctx);
    const after = await trainingMarksForRoster(ctx.db, ctx.shop.id, ctx.charter, [
      await seatInput(),
    ]);
    expect(after.bySeat.get(ctx.seat.id)?.mark).toMatchObject({
      enrollmentBookingId: ctx.course.bookingId,
      valid: true,
      courseInstructorAboard: false,
      intro: true,
    });
    const manifest = await getTripManifest(ctx.db, ctx.shop.id, ctx.charter.id);
    expect(
      manifest?.divers.find((diver) => diver.bookingId === ctx.seat.id)?.trainingDive,
    ).toMatchObject({ intro: true });
    expect(after.bySeat.get(ctx.seat.id)?.options).toEqual([]);
    // A later identity hold must not put this course onto the boat copy.
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: ctx.now })
      .where(eq(bookings.id, ctx.seat.id));
    const heldManifest = await getTripManifest(ctx.db, ctx.shop.id, ctx.charter.id);
    expect(
      heldManifest?.divers.find((diver) => diver.bookingId === ctx.seat.id)?.trainingDive,
    ).toBeNull();
  });
});
