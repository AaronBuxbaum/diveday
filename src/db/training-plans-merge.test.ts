import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { mergeDiverRecords } from "./diver-merge";
import { bookings, people, personRoles, tripAssignments, trips } from "./schema";

const ctx = fileScopedShopContext();

it("clears plans involving a merged person before moving their booking", async () => {
  const { db, shop } = ctx;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const [source, survivor, helper] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
      { shopId: shop.id, fullName: "Maya Rivera", email: "maya@example.com" },
      { shopId: shop.id, fullName: "Helper" },
    ])
    .returning();
  if (!source || !survivor || !helper) throw new Error("people missing");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Planning trip",
      startsAt: new Date(nowDate().getTime() + 24 * 60 * 60 * 1000),
      endsAt: new Date(nowDate().getTime() + 25 * 60 * 60 * 1000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [seat] = await db
    .insert(bookings)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      personId: source.id,
      bookedAs: "diver",
      trainingPlanInstructorPersonId: owner,
      trainingPlanByPersonId: owner,
      trainingPlanAt: nowDate(),
    })
    .returning();
  if (!seat) throw new Error("seat missing");
  await db.insert(tripAssignments).values({
    tripId: trip.id,
    personId: helper.id,
    tripRole: "crew",
    trainingPlanInstructorPersonId: source.id,
    trainingPlanByPersonId: owner,
    trainingPlanAt: nowDate(),
  });
  expect(
    (
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner,
      })
    ).ok,
  ).toBe(true);
  const [afterSeat] = await db.select().from(bookings).where(eq(bookings.id, seat.id));
  const [afterCrew] = await db
    .select()
    .from(tripAssignments)
    .where(and(eq(tripAssignments.tripId, trip.id), eq(tripAssignments.personId, helper.id)));
  expect(afterSeat).toMatchObject({
    personId: survivor.id,
    trainingPlanInstructorPersonId: null,
    trainingPlanByPersonId: null,
    trainingPlanAt: null,
  });
  expect(afterCrew).toMatchObject({
    trainingPlanInstructorPersonId: null,
    trainingPlanByPersonId: null,
    trainingPlanAt: null,
  });
});
