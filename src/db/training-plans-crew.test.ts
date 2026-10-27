import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat } from "@/test/training-mark-context";
import { bookings, people, personRoles, tripAssignments } from "./schema";
import { readTrainingPlan, setTrainingPlanAssignment } from "./training-plans";
import { changeTripCrewOutcome, setTripCrew } from "./trips-crew";

const ctx = fileScopedShopContext();

async function planned() {
  const f = await charterContext(ctx);
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
  ]);
  expect((await markSeat(f)).ok).toBe(true);
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        shopId: f.shop.id,
        tripId: f.charter.id,
        actorPersonId: f.owner,
        subject: { kind: "assistant", personId: helper.id },
        instructorPersonId: f.instructor,
      })
    ).ok,
  ).toBe(true);
  await f.db
    .update(bookings)
    .set({
      trainingPlanInstructorPersonId: f.instructor,
      trainingPlanByPersonId: f.owner,
      trainingPlanAt: f.now,
    })
    .where(eq(bookings.id, f.seat.id));
  return { ...f, helper };
}

it("retains a helper's plan when a full crew edit keeps both jobs unchanged", async () => {
  const f = await planned();
  expect(
    await setTripCrew(f.db, f.shop.id, f.charter.id, [f.instructor, f.helper.id], {
      actorPersonId: f.owner,
    }),
  ).toBe(true);
  expect((await readTrainingPlan(f.db, f.shop.id, f.charter.id)).assistants).toContainEqual({
    assistantPersonId: f.helper.id,
    instructorPersonId: f.instructor,
  });
});

it("clears plans when an instructor leaves and does not revive them on return", async () => {
  const f = await planned();
  expect(
    (
      await changeTripCrewOutcome(
        f.db,
        f.shop.id,
        f.charter.id,
        { operation: "unassign", personId: f.instructor },
        { actorPersonId: f.owner },
      )
    ).ok,
  ).toBe(true);
  expect(await readTrainingPlan(f.db, f.shop.id, f.charter.id)).toEqual({
    students: [],
    assistants: [],
  });
  expect(
    (
      await changeTripCrewOutcome(
        f.db,
        f.shop.id,
        f.charter.id,
        { operation: "assign", personId: f.instructor, tripRole: "instructor" },
        { actorPersonId: f.owner },
      )
    ).ok,
  ).toBe(true);
  expect(await readTrainingPlan(f.db, f.shop.id, f.charter.id)).toEqual({
    students: [],
    assistants: [],
  });
});

it("clears a student's plan when their instructor leaves the course session", async () => {
  const f = await planned();
  const [backup] = await f.db
    .insert(people)
    .values({ shopId: f.shop.id, fullName: "Second instructor" })
    .returning();
  if (!backup) throw new Error("backup missing");
  await f.db.insert(personRoles).values({ personId: backup.id, role: "instructor" });
  await f.db.insert(tripAssignments).values(
    [f.instructor, backup.id].map((personId) => ({
      tripId: f.course.tripId,
      personId,
      tripRole: "instructor" as const,
      assignedByPersonId: f.owner,
    })),
  );
  expect(
    (
      await changeTripCrewOutcome(
        f.db,
        f.shop.id,
        f.course.tripId,
        { operation: "unassign", personId: f.instructor },
        { actorPersonId: f.owner },
      )
    ).ok,
  ).toBe(true);
  const plan = await readTrainingPlan(f.db, f.shop.id, f.charter.id);
  expect(plan.students).toEqual([]);
  expect(plan.assistants).toContainEqual({
    assistantPersonId: f.helper.id,
    instructorPersonId: f.instructor,
  });
});

it("clears affected plans when an instructor changes to a deck role", async () => {
  const f = await planned();
  expect(
    (
      await changeTripCrewOutcome(
        f.db,
        f.shop.id,
        f.charter.id,
        { operation: "assign", personId: f.instructor, tripRole: "captain" },
        { actorPersonId: f.owner },
      )
    ).ok,
  ).toBe(true);
  expect(await readTrainingPlan(f.db, f.shop.id, f.charter.id)).toEqual({
    students: [],
    assistants: [],
  });
});
