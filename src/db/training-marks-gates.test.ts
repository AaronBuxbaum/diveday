import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  charterContext as charterContextFor,
  markSeat,
  seatBlockerCodes,
} from "@/test/training-mark-context";
import { signCourseForm } from "./course-forms";
import { bookings, people } from "./schema";

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
});
