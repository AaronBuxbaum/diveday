import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat, seatBlockerCodes } from "@/test/training-mark-context";
import { recordCrewRollCall } from "./manifests";
import { courses, people, personRoles, tripAssignments } from "./schema";
import { trainingPlanView } from "./training-plan-view";
import { readTrainingPlan, setTrainingPlanAssignment } from "./training-plans";

const ctx = fileScopedShopContext();

it("keeps plans unresolved when a not-aboard instructor later returns", async () => {
  const f = await charterContext(ctx);
  await f.db
    .update(courses)
    .set({ agency: "PADI", minimumCertificationLevel: null, isIntroCourse: false })
    .where(eq(courses.id, f.course.courseId));
  const [helper] = await f.db
    .insert(people)
    .values({ shopId: f.shop.id, fullName: "Plan helper" })
    .returning();
  if (!helper) throw new Error("helper missing");
  await f.db.insert(personRoles).values({ personId: helper.id, role: "divemaster" });
  await f.db.insert(tripAssignments).values([
    {
      tripId: f.charter.id,
      personId: f.instructor,
      tripRole: "instructor",
      assignedByPersonId: f.owner,
    },
    {
      tripId: f.charter.id,
      personId: helper.id,
      tripRole: "divemaster",
      assignedByPersonId: f.owner,
    },
    {
      tripId: f.course.tripId,
      personId: f.instructor,
      tripRole: "instructor",
      assignedByPersonId: f.owner,
    },
  ]);
  expect((await markSeat(f)).ok).toBe(true);
  const beforePlan = await seatBlockerCodes(f);
  const base = {
    shopId: f.shop.id,
    tripId: f.charter.id,
    actorPersonId: f.owner,
    instructorPersonId: f.instructor,
  };
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        ...base,
        subject: { kind: "student", bookingId: f.seat.id },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        ...base,
        subject: { kind: "assistant", personId: helper.id },
      })
    ).ok,
  ).toBe(true);
  expect(
    (await trainingPlanView(f.db, f.shop.id, f.charter.id))?.allocation.unresolvedStudents.size,
  ).toBe(0);
  expect(await seatBlockerCodes(f)).toEqual(beforePlan);
  const rollCall = {
    shopId: f.shop.id,
    tripId: f.charter.id,
    personId: f.instructor,
    recordedByPersonId: f.owner,
  };
  expect((await recordCrewRollCall(f.db, { ...rollCall, status: "boarded" })).ok).toBe(true);
  const stale = await recordCrewRollCall(f.db, {
    ...rollCall,
    status: "not_boarded",
    source: "offline",
    clientEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    occurredAt: new Date(f.now.getTime() - 60 * 60 * 1000),
    offlineSnapshotSavedAt: new Date(f.now.getTime() - 2 * 60 * 60 * 1000),
  });
  expect(stale).toEqual({ ok: false, reason: "newer_event_exists" });
  expect((await readTrainingPlan(f.db, f.shop.id, f.charter.id)).students).toHaveLength(1);
  advanceClock(1000);
  expect((await recordCrewRollCall(f.db, { ...rollCall, status: "not_boarded" })).ok).toBe(true);
  const absent = await trainingPlanView(f.db, f.shop.id, f.charter.id);
  expect(absent?.allocation.unresolvedStudents.has(f.seat.id)).toBe(true);
  expect(absent?.allocation.unresolvedAssistants.has(helper.id)).toBe(true);
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        ...base,
        subject: { kind: "student", bookingId: f.seat.id },
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        ...base,
        subject: { kind: "assistant", personId: helper.id },
      })
    ).ok,
  ).toBe(false);
  advanceClock(1000);
  expect((await recordCrewRollCall(f.db, { ...rollCall, status: "boarded" })).ok).toBe(true);
  const returned = await trainingPlanView(f.db, f.shop.id, f.charter.id);
  expect(returned?.allocation.unresolvedStudents.has(f.seat.id)).toBe(true);
  expect(returned?.allocation.unresolvedAssistants.has(helper.id)).toBe(true);
  expect(await readTrainingPlan(f.db, f.shop.id, f.charter.id)).toEqual({
    students: [],
    assistants: [],
  });
});
