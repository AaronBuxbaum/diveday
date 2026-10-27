import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat } from "@/test/training-mark-context";
import { anonymizeDiver } from "./anonymize";
import { courses, people, personRoles, shops, tripAssignments } from "./schema";
import { clearTrainingDive, dropTrainingMarkWithin } from "./training-marks";
import { trainingPlanView } from "./training-plan-view";
import { readTrainingPlan, setTrainingPlanAssignment } from "./training-plans";

const fileCtx = fileScopedShopContext();

describe("training planning assignments", () => {
  it("records one assistant with one rostered instructor without changing the training mark", async () => {
    const ctx = await charterContext(fileCtx);
    const [helper] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "Plan helper" })
      .returning();
    if (!helper) throw new Error("helper not created");
    await ctx.db.insert(personRoles).values({ personId: helper.id, role: "divemaster" });
    await ctx.db.insert(tripAssignments).values([
      {
        tripId: ctx.charter.id,
        personId: ctx.instructor,
        tripRole: "instructor",
        assignedByPersonId: ctx.owner,
      },
      {
        tripId: ctx.charter.id,
        personId: helper.id,
        tripRole: "divemaster",
        assignedByPersonId: ctx.owner,
      },
    ]);
    expect((await markSeat(ctx)).ok).toBe(true);
    expect(
      await setTrainingPlanAssignment(ctx.db, {
        shopId: ctx.shop.id,
        tripId: ctx.charter.id,
        actorPersonId: ctx.owner,
        subject: { kind: "assistant", personId: helper.id },
        instructorPersonId: ctx.instructor,
      }),
    ).toEqual({ ok: true });
    const [otherShop] = await ctx.db
      .insert(shops)
      .values({ name: "Other Reef", slug: `plan-other-${crypto.randomUUID()}`, timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("other shop not created");
    expect(await readTrainingPlan(ctx.db, otherShop.id, ctx.charter.id)).toEqual({
      assistants: [],
      students: [],
    });
    expect(
      await setTrainingPlanAssignment(ctx.db, {
        shopId: otherShop.id,
        tripId: ctx.charter.id,
        actorPersonId: ctx.owner,
        subject: { kind: "assistant", personId: helper.id },
        instructorPersonId: ctx.instructor,
      }),
    ).toEqual({ ok: false });
    const plan = await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id);
    expect(plan.assistants).toContainEqual({
      assistantPersonId: helper.id,
      instructorPersonId: ctx.instructor,
    });
    expect(
      await setTrainingPlanAssignment(ctx.db, {
        shopId: ctx.shop.id,
        tripId: ctx.charter.id,
        actorPersonId: ctx.captain,
        subject: { kind: "assistant", personId: helper.id },
        instructorPersonId: ctx.instructor,
      }),
    ).toEqual({ ok: false });
    const [crew] = await ctx.db
      .select()
      .from(tripAssignments)
      .where(
        and(eq(tripAssignments.tripId, ctx.charter.id), eq(tripAssignments.personId, helper.id)),
      );
    expect(crew?.tripRole).toBe("divemaster");
  });

  it("assigns a marked student only to a rostered session instructor and clears the plan with the mark", async () => {
    const ctx = await charterContext(fileCtx);
    await ctx.db.insert(tripAssignments).values({
      tripId: ctx.charter.id,
      personId: ctx.instructor,
      tripRole: "instructor",
      assignedByPersonId: ctx.owner,
    });
    expect((await markSeat(ctx)).ok).toBe(true);
    const input = {
      shopId: ctx.shop.id,
      tripId: ctx.charter.id,
      actorPersonId: ctx.owner,
      subject: { kind: "student" as const, bookingId: ctx.seat.id },
      instructorPersonId: ctx.instructor,
    };
    expect(await setTrainingPlanAssignment(ctx.db, input)).toEqual({ ok: false });
    await ctx.db.insert(tripAssignments).values({
      tripId: ctx.course.tripId,
      personId: ctx.instructor,
      tripRole: "instructor",
      assignedByPersonId: ctx.owner,
    });
    expect(await setTrainingPlanAssignment(ctx.db, input)).toEqual({ ok: true });
    // Even an edited prerequisite cannot turn continuing education into Open Water coverage.
    await ctx.db
      .update(courses)
      .set({
        certifiesLevel: "advanced_open_water",
        minimumCertificationLevel: null,
        sourceTemplateSlug: "advanced-open-water-diver",
        isIntroCourse: false,
        agency: "PADI",
      })
      .where(eq(courses.id, ctx.course.courseId));
    const view = await trainingPlanView(ctx.db, ctx.shop.id, ctx.charter.id);
    expect(view?.students.find((student) => student.id === ctx.seat.id)).toMatchObject({
      instructorPersonId: ctx.instructor,
      eligible: [ctx.instructor],
    });
    // A continuing course has no modeled ratio; an assignment must not invent one.
    expect(view?.students.find((student) => student.id === ctx.seat.id)?.rule).toBeNull();
    expect(view?.allocation.unresolvedStudents.has(ctx.seat.id)).toBe(true);
    expect((await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id)).students).toContainEqual({
      bookingId: ctx.seat.id,
      instructorPersonId: ctx.instructor,
    });
    expect(
      (
        await clearTrainingDive(ctx.db, {
          shopId: ctx.shop.id,
          bookingId: ctx.seat.id,
          actorPersonId: ctx.owner,
        })
      ).ok,
    ).toBe(true);
    expect((await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id)).students).toEqual([]);
    expect(await setTrainingPlanAssignment(ctx.db, input)).toEqual({ ok: false });
    expect((await markSeat(ctx)).ok).toBe(true);
    expect(await setTrainingPlanAssignment(ctx.db, input)).toEqual({ ok: true });
    await ctx.db.transaction((tx) =>
      dropTrainingMarkWithin(tx, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.id,
        actorPersonId: ctx.owner,
        now: ctx.now,
      }),
    );
    expect((await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id)).students).toEqual([]);
    expect((await markSeat(ctx)).ok).toBe(true);
    expect((await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id)).students).toEqual([]);
  });

  it("erases an assistant's planning assignment and refuses to recreate it", async () => {
    const ctx = await charterContext(fileCtx);
    const [helper] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: "Plan helper" })
      .returning();
    if (!helper) throw new Error("helper not created");
    await ctx.db.insert(personRoles).values({ personId: helper.id, role: "divemaster" });
    await ctx.db.insert(tripAssignments).values([
      {
        tripId: ctx.charter.id,
        personId: ctx.instructor,
        tripRole: "instructor",
        assignedByPersonId: ctx.owner,
      },
      {
        tripId: ctx.charter.id,
        personId: helper.id,
        tripRole: "divemaster",
        assignedByPersonId: ctx.owner,
      },
    ]);
    const plan = {
      shopId: ctx.shop.id,
      tripId: ctx.charter.id,
      actorPersonId: ctx.owner,
      subject: { kind: "assistant" as const, personId: helper.id },
      instructorPersonId: ctx.instructor,
    };
    expect(await setTrainingPlanAssignment(ctx.db, plan)).toEqual({ ok: true });
    await ctx.db.delete(personRoles).where(eq(personRoles.personId, helper.id));
    expect(
      await anonymizeDiver(ctx.db, {
        shopId: ctx.shop.id,
        personId: helper.id,
        actorPersonId: ctx.owner,
      }),
    ).toMatchObject({ ok: true });
    expect((await readTrainingPlan(ctx.db, ctx.shop.id, ctx.charter.id)).assistants).toEqual([]);
    expect(await setTrainingPlanAssignment(ctx.db, plan)).toEqual({ ok: false });
  });
});
