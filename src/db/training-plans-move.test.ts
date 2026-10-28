import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { charterContext, markSeat } from "@/test/training-mark-context";
import { moveBooking } from "./bookings";
import { bookings, tripAssignments, tripRequirements, trips } from "./schema";
import { readTrainingPlan, setTrainingPlanAssignment } from "./training-plans";

const ctx = fileScopedShopContext();

it("does not carry a student's instructor plan when the seat moves to another departure", async () => {
  const f = await charterContext(ctx);
  const [target] = await f.db
    .insert(trips)
    .values({
      shopId: f.shop.id,
      title: "Another charter",
      startsAt: f.charter.startsAt,
      endsAt: f.charter.endsAt,
      capacity: 10,
    })
    .returning();
  if (!target) throw new Error("target missing");
  await f.db
    .insert(tripRequirements)
    .values({ shopId: f.shop.id, tripId: target.id, requiresWaiver: false });
  await f.db.insert(tripAssignments).values(
    [f.charter.id, target.id, f.course.tripId].map((tripId) => ({
      tripId,
      personId: f.instructor,
      tripRole: "instructor" as const,
      assignedByPersonId: f.owner,
    })),
  );
  expect((await markSeat(f)).ok).toBe(true);
  expect(
    (
      await setTrainingPlanAssignment(f.db, {
        shopId: f.shop.id,
        tripId: f.charter.id,
        actorPersonId: f.owner,
        subject: { kind: "student", bookingId: f.seat.id },
        instructorPersonId: f.instructor,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await moveBooking(f.db, {
        shopId: f.shop.id,
        fromTripId: f.charter.id,
        toTripId: target.id,
        bookingId: f.seat.id,
      })
    ).ok,
  ).toBe(true);
  const [seat] = await f.db.select().from(bookings).where(eq(bookings.id, f.seat.id));
  expect(seat).toMatchObject({
    trainingPlanInstructorPersonId: null,
    trainingPlanByPersonId: null,
    trainingPlanAt: null,
  });
  expect((await readTrainingPlan(f.db, f.shop.id, target.id)).students).toEqual([]);
});
