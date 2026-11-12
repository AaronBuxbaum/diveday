import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBookingParty } from "./bookings";
import { lockPartySchedule } from "./person-schedule-lock";
import { people, personRoles } from "./schema";
import { createTrip } from "./trips";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describePostgres("party schedule lock", () => {
  it("serializes opposite-order parties before they take person locks", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const persons = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "A" },
        { shopId: shop.id, fullName: "B" },
      ])
      .returning();
    const [a, b] = persons;
    if (!a || !b) throw new Error("expected people");
    await pg.db.insert(personRoles).values([
      { personId: a.id, role: "diver" },
      { personId: b.id, role: "diver" },
    ]);
    const make = (title: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date("2035-08-04T08:00:00Z"),
        endsAt: new Date("2035-08-04T12:00:00Z"),
        capacity: 8,
      });
    const first = await make("First");
    const second = await make("Second");
    if (!first || !second) throw new Error("expected trips");
    const held = deferred();
    const release = deferred();
    const holder = pg.connect().transaction(async (tx) => {
      await lockPartySchedule(tx, shop.id);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const request = (tripId: string, personId: string) => ({
      shopId: shop.id,
      tripId,
      personId,
      actor: "staff" as const,
    });
    const one = createBookingParty(pg.connect(), [
      request(first.id, a.id),
      request(first.id, b.id),
    ]);
    const two = createBookingParty(pg.connect(), [
      request(second.id, b.id),
      request(second.id, a.id),
    ]);
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      release.resolve();
    }
    await holder;
    expect((await one).ok).toBe(true);
    expect((await two).ok).toBe(true);
  });
});
