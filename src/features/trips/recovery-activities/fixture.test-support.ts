import { randomUUID } from "node:crypto";
import { callTripBlowout, getTripBlowout } from "../../../db/blowouts";
import { createBooking } from "../../../db/bookings";
import type { AppDb } from "../../../db/client";
import { createTrip } from "../../../db/trips";
import { nowDate } from "../../../lib/clock";
import { fakeEmail } from "../../../test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../../../test/staff-session";
import { createRecoveryActivity } from "./store";

export async function classroomFixture(db: AppDb, shop: { id: string }, ownerId?: string) {
  const owner = ownerId ?? (await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL));
  const startsAt = new Date(nowDate().getTime() + 3 * 86400000);
  const source = await createTrip(db, {
    shopId: shop.id,
    title: "Classroom recovery source",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3600000),
    capacity: 8,
    plannedDives: 1,
  });
  if (!source) throw new Error("source missing");
  const seats = [];
  for (const name of ["Maya Storm", "Rey Coast"]) {
    const seat = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: source.id,
      fullName: name,
      email: `${name.split(" ")[0].toLowerCase()}-classroom@example.com`,
    });
    if (!seat.ok) throw new Error(seat.reason);
    seats.push(seat);
  }
  await callTripBlowout(db, {
    shopId: shop.id,
    tripId: source.id,
    calledByPersonId: owner,
    refunds: "queue",
    provider: fakeEmail().provider,
  });
  const blowout = await getTripBlowout(db, shop.id, source.id);
  if (!blowout) throw new Error("snapshot missing");
  const create = {
    shopId: shop.id,
    tripId: source.id,
    actorPersonId: owner,
    attemptId: randomUUID(),
    title: "Reef photography classroom",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3600000),
    location: "Shop classroom",
    capacity: 1,
    coordinatorPersonId: owner,
    arrangementsConfirmed: true,
  };
  const made = await createRecoveryActivity(db, create);
  if (!made.ok) throw new Error(`classroom: ${made.reason}`);
  const confirm = {
    shopId: shop.id,
    tripId: source.id,
    actorPersonId: owner,
    attemptId: randomUUID(),
    activityId: create.attemptId,
    expectedRevision: 0,
    kind: "confirm" as const,
    blowoutDiverId: blowout.divers[0].id,
    participantRevision: 0,
  };
  return { db, shop, owner, source, blowout, seats, create, confirm };
}
