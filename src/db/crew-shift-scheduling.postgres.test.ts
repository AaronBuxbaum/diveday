import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { people, personRoles, shops, staffShifts, tripAssignments } from "./schema";
import { createTrip } from "./trips-create";
import { changeTripCrewOutcome } from "./trips-crew";

async function fixture() {
  const pg = await postgresTestDb();
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({
      name: "Shift race",
      slug: `shift-race-${suffix}`,
      timezone: "UTC",
      crewScheduleEnabled: true,
    })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Crew" })
    .returning();
  if (!person) throw new Error("person missing");
  await pg.db.insert(personRoles).values({ personId: person.id, role: "divemaster" });
  const startsAt = new Date(nowDate().getTime() + 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Shift race",
    startsAt,
    endsAt,
    capacity: 6,
  });
  if (!trip) throw new Error("trip missing");
  const [shift] = await pg.db
    .insert(staffShifts)
    .values({ shopId: shop.id, personId: person.id, startsAt, endsAt })
    .returning();
  if (!shift) throw new Error("shift missing");
  return { pg, shop, person, trip, shift };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describePostgres("shift deletion against advance crew assignment", () => {
  it("refuses the plan when the shift deletion commits first", async () => {
    const { pg, shop, person, trip, shift } = await fixture();
    const deleted = deferred();
    const release = deferred();
    const deleting = pg.connect().transaction(async (tx) => {
      await tx.delete(staffShifts).where(eq(staffShifts.id, shift.id));
      deleted.resolve();
      await release.promise;
    });
    void deleting.catch(() => deleted.resolve());
    await deleted.promise;
    const assigning = changeTripCrewOutcome(
      pg.connect(),
      shop.id,
      trip.id,
      { operation: "assign", personId: person.id },
      { requireScheduledShift: true },
    );
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release.resolve();
    }
    await deleting;
    expect(await assigning).toMatchObject({ ok: false });
    expect(
      await pg.db.select().from(tripAssignments).where(eq(tripAssignments.tripId, trip.id)),
    ).toEqual([]);
  });

  it("retains the assignment if its checked shift is deleted after the plan commits", async () => {
    const { pg, shop, person, trip, shift } = await fixture();
    const assigned = deferred();
    const release = deferred();
    const assigning = pg.connect().transaction(async (tx) => {
      const outcome = await changeTripCrewOutcome(
        tx as unknown as AppDb,
        shop.id,
        trip.id,
        { operation: "assign", personId: person.id },
        { requireScheduledShift: true },
      );
      assigned.resolve();
      await release.promise;
      return outcome;
    });
    void assigning.catch(() => assigned.resolve());
    await assigned.promise;
    const deleting = pg
      .connect()
      .delete(staffShifts)
      .where(eq(staffShifts.id, shift.id))
      .then(() => undefined);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release.resolve();
    }
    expect(await assigning).toEqual({ ok: true });
    await deleting;
    const crew = await pg.db
      .select()
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, trip.id));
    expect(crew.map((member) => member.personId)).toEqual([person.id]);
  });
});
