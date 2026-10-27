import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { recordDeskEvent } from "./desk-events";
import { people, todayReadMarkEvents, tripDeskEvents } from "./schema";
import {
  acknowledgeTodayCatchUp,
  initializeTodayCatchUp,
  readTodayCatchUp,
} from "./today-catch-up";
import { createTrip } from "./trips";

const now = new Date("2031-05-12T10:00:00Z");

describePostgres("Today catch-up on PostgreSQL", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Reader" })
      .returning();
    if (!person) throw new Error("reader missing");
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Today boat",
      startsAt: now,
      endsAt: new Date(now.getTime() + 4 * HOUR_MS),
      capacity: 6,
    });
    if (!trip) throw new Error("trip missing");
    return {
      pg,
      shop,
      trip,
      input: { shopId: shop.id, personId: person.id, now, timeZone: "UTC" },
    };
  }

  it("shows a lower sequence event that commits after the acknowledged event", async () => {
    const { pg, shop, trip, input } = await fixture();
    await initializeTodayCatchUp(pg.db, { ...input, eventIds: [] });
    let release!: () => void;
    let written!: () => void;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      written = resolve;
    });
    const first = pg.connect().transaction(async (tx) => {
      await recordDeskEvent(tx, {
        shopId: shop.id,
        tripId: trip.id,
        kind: "plan_changed",
        occurredAt: now,
      });
      written();
      await holding;
    });
    try {
      await inserted;
      await recordDeskEvent(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        kind: "meeting_point",
        occurredAt: now,
      });
      const snapshot = await readTodayCatchUp(pg.db, input);
      expect(snapshot.events.map((e) => e.kind)).toEqual(["meeting_point"]);
      await acknowledgeTodayCatchUp(pg.db, { ...input, eventIds: snapshot.snapshotIds });
    } finally {
      release();
      await first;
    }
    expect((await readTodayCatchUp(pg.db, input)).events.map((e) => e.kind)).toEqual([
      "plan_changed",
    ]);
  });

  it("initializes once and unions simultaneous acknowledgements", async () => {
    const { pg, shop, trip, input } = await fixture();
    const init = await Promise.all([
      initializeTodayCatchUp(pg.connect(), { ...input, eventIds: [] }),
      initializeTodayCatchUp(pg.connect(), { ...input, eventIds: [] }),
    ]);
    expect(init.sort()).toEqual([false, true]);
    await recordDeskEvent(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "plan_changed",
      occurredAt: now,
    });
    await recordDeskEvent(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "meeting_point",
      occurredAt: now,
    });
    const snapshot = await readTodayCatchUp(pg.db, input);
    expect(snapshot.snapshotIds).toHaveLength(2);
    await Promise.all(
      snapshot.snapshotIds.map((id) =>
        acknowledgeTodayCatchUp(pg.connect(), { ...input, eventIds: [id] }),
      ),
    );
    expect((await readTodayCatchUp(pg.db, input)).events).toEqual([]);
  });

  it("survives an event being pruned while its acknowledgement waits", async () => {
    const { pg, shop, trip, input } = await fixture();
    await initializeTodayCatchUp(pg.db, { ...input, eventIds: [] });
    await recordDeskEvent(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "plan_changed",
      occurredAt: now,
    });
    const snapshot = await readTodayCatchUp(pg.db, input);
    const [id] = snapshot.snapshotIds;
    if (!id) throw new Error("event missing");
    let release!: () => void;
    let removed!: () => void;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleted = new Promise<void>((resolve) => {
      removed = resolve;
    });
    const prune = pg.connect().transaction(async (tx) => {
      await tx.delete(tripDeskEvents).where(eq(tripDeskEvents.id, id));
      removed();
      await holding;
    });
    await deleted;
    const ack = acknowledgeTodayCatchUp(pg.connect(), { ...input, eventIds: [id] });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await prune;
    }
    expect(await ack).toBe(true);
    expect(await pg.db.select().from(todayReadMarkEvents)).toHaveLength(0);
  });
});
