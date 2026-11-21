import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { crewAwayByTrip } from "../features/crew-and-boats/crew-away";
import { acknowledgeCrewAway } from "./crew-away-acknowledgements";
import { createPerson } from "./people";
import { crewAvailabilityBlocks, tripAssignments, tripScheduleDays } from "./schema";
import { createTrip, editTripSection, listTripScheduleDays } from "./trips";

async function fixture() {
  const pg = await postgresTestDb();
  const shop = await raceShop(pg.db, "Meeting no-op");
  const days = [0, 1].map((offset) => ({
    dayNumber: offset + 1,
    startsAt: new Date(Date.UTC(2035, 3, 10 + offset, 12)),
    endsAt: new Date(Date.UTC(2035, 3, 10 + offset, 16)),
  }));
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Two-day course",
    startsAt: days[0].startsAt,
    endsAt: days[1].endsAt,
    capacity: 8,
    scheduleDays: days,
  });
  if (!trip) throw new Error("trip missing");
  return { pg, shop, trip, days };
}

describePostgres("meeting-day saves on real PostgreSQL", () => {
  it("keeps rows for an identical schedule but replaces them for a material edit", async () => {
    const { pg, shop, trip, days } = await fixture();
    const before = await listTripScheduleDays(pg.db, shop.id, trip.id);
    expect(await editTripSection(pg.db, shop.id, trip.id, { scheduleDays: days })).toMatchObject({
      ok: true,
    });
    expect(await listTripScheduleDays(pg.db, shop.id, trip.id)).toEqual(before);

    const changed = [days[0], { ...days[1], startsAt: new Date("2035-04-11T13:00:00Z") }];
    expect(await editTripSection(pg.db, shop.id, trip.id, { scheduleDays: changed })).toMatchObject(
      { ok: true },
    );
    const after = await listTripScheduleDays(pg.db, shop.id, trip.id);
    expect(after.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual(
      changed.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    );
    expect(after.map((day) => day.id)).not.toEqual(before.map((day) => day.id));
  });

  it("still normalizes stored sub-millisecond instants on an explicit save", async () => {
    const { pg, shop, trip, days } = await fixture();
    await pg.db
      .update(tripScheduleDays)
      .set({ startsAt: sql`${tripScheduleDays.startsAt} + interval '1 microsecond'` })
      .where(and(eq(tripScheduleDays.tripId, trip.id), eq(tripScheduleDays.dayNumber, 2)));
    const aligned = async () => {
      const [row] = await pg.db
        .select({
          value: sql<boolean>`date_trunc('milliseconds', ${tripScheduleDays.startsAt}) = ${tripScheduleDays.startsAt}`,
        })
        .from(tripScheduleDays)
        .where(and(eq(tripScheduleDays.tripId, trip.id), eq(tripScheduleDays.dayNumber, 2)));
      return row?.value;
    };
    expect(await aligned()).toBe(false);
    expect(await editTripSection(pg.db, shop.id, trip.id, { scheduleDays: days })).toMatchObject({
      ok: true,
    });
    expect(await aligned()).toBe(true);
  });

  it("decides whether to rewrite using the days committed before its trip lock", async () => {
    const { pg, shop, trip, days } = await fixture();
    const before = await listTripScheduleDays(pg.db, shop.id, trip.id);
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const changed = [days[0], { ...days[1], startsAt: new Date("2035-04-11T13:00:00Z") }];
    const writer = editTripSection(pg.connect(), shop.id, trip.id, { scheduleDays: changed });
    void writer.catch(() => undefined);
    try {
      await waitForLockWaiters(pg.db, 1);
      const save = editTripSection(pg.connect(), shop.id, trip.id, { scheduleDays: days });
      void save.catch(() => undefined);
      try {
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      expect(await writer).toMatchObject({ ok: true });
      expect(await save).toMatchObject({ ok: true });
    } finally {
      await gate.release();
    }
    const after = await listTripScheduleDays(pg.db, shop.id, trip.id);
    expect(after.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual(
      days.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    );
    expect(after.map((day) => day.id)).not.toEqual(before.map((day) => day.id));
  });

  it("does not report a stale no-op while an independent meeting-row writer is uncommitted", async () => {
    const { pg, shop, trip, days } = await fixture();
    const crew = await createPerson(pg.db, {
      shopId: shop.id,
      fullName: "Crew member",
      email: null,
      phone: null,
      origin: "seed",
      roles: [],
    });
    const actor = await createPerson(pg.db, {
      shopId: shop.id,
      fullName: "Desk staff",
      email: null,
      phone: null,
      origin: "seed",
      roles: [],
    });
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.id });
    await pg.db.insert(crewAvailabilityBlocks).values({
      shopId: shop.id,
      personId: crew.id,
      createdByPersonId: crew.id,
      startsOn: "2035-04-11",
      endsOn: "2035-04-11",
    });
    expect(
      await acknowledgeCrewAway(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        actorPersonId: actor.id,
      }),
    ).toBe("saved");
    const acknowledged = async () =>
      (await crewAwayByTrip(pg.db, shop.id, [trip.id], shop.timezone))
        .get(trip.id)
        ?.find((row) => row.personId === crew.id)?.acknowledged;
    expect(await acknowledged()).toBe(true);
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = pg.connect().transaction(async (tx) => {
      await tx
        .update(tripScheduleDays)
        .set({ startsAt: new Date("2035-04-11T13:00:00Z") })
        .where(and(eq(tripScheduleDays.tripId, trip.id), eq(tripScheduleDays.dayNumber, 2)));
      locked();
      await gate;
    });
    try {
      await Promise.race([ready, writer]);
      const save = editTripSection(pg.connect(), shop.id, trip.id, { scheduleDays: days });
      void save.catch(() => undefined);
      const waiting = waitForLockWaiters(pg.db, 1).then(
        () => "waiting" as const,
        () => "not-waiting" as const,
      );
      const outcome = await Promise.race([waiting, save.then(() => "finished" as const)]);
      expect(outcome).toBe("waiting");
      release();
      await writer;
      expect(await save).toMatchObject({ ok: true });
    } finally {
      release();
      await writer;
    }
    const after = await listTripScheduleDays(pg.db, shop.id, trip.id);
    expect(after.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual(
      days.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
    );
    expect(await acknowledged()).toBe(false);
  });
});
