import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import type { AppDb } from "@/db/client";
import {
  capturePrototypeSighting,
  installGenerationPrototype,
  type PrototypeContext,
  rotatePrototypeGeneration,
  seedGenerationPrototype,
  setPrototypeErased,
} from "@/test/boarding-receipt-prototype/generation-store";
import { describePostgres, postgresTestDb } from "@/test/postgres";

function context(): PrototypeContext {
  return {
    shopId: randomUUID(),
    actorId: randomUUID(),
    tripId: randomUUID(),
    bookingId: randomUUID(),
    generationId: randomUUID(),
    meetingId: randomUUID(),
  };
}
async function arrivesBeforeRelease<T>(operation: Promise<T>): Promise<T | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => resolve("timed_out"), 1500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describePostgres("isolated generation model, not production intake", () => {
  it("commits an old-generation event while reset holds its new head before commit", async () => {
    const pg = await postgresTestDb();
    await installGenerationPrototype(pg.db);
    const original = context();
    const next = { ...original, generationId: randomUUID(), meetingId: randomUUID() };
    const event = { ...original, eventId: randomUUID() };
    await seedGenerationPrototype(pg.db, original);
    const before = await pg.db.execute(
      sql`select * from draft_gen_context where shop_id = ${original.shopId} and generation_id = ${original.generationId}`,
    );
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const reset = pg.connect().transaction(async (tx) => {
      await rotatePrototypeGeneration(tx, original, next);
      ready();
      await gate;
    });
    void reset.catch(() => undefined);
    let intake: ReturnType<typeof capturePrototypeSighting> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([reset, ...(intake ? [intake] : [])]);
    });
    try {
      const reached = await arrivesBeforeRelease(
        Promise.race([
          held.then(() => "held" as const),
          reset.then(() => {
            throw new Error("reset did not hold");
          }),
        ]),
      );
      expect(reached).toBe("held");
      intake = capturePrototypeSighting(pg.connect(), event);
      expect(await arrivesBeforeRelease(intake)).toBe("recorded");
      const saved = await pg.db.execute(
        sql`select actor_id, trip_id, generation_id, meeting_id, booking_id from draft_gen_observation where shop_id = ${event.shopId} and event_id = ${event.eventId}`,
      );
      expect(saved.rows).toMatchObject([
        {
          actor_id: original.actorId,
          trip_id: original.tripId,
          generation_id: original.generationId,
          meeting_id: original.meetingId,
          booking_id: original.bookingId,
        },
      ]);
    } finally {
      release();
      await reset;
    }
    const after = await pg.db.execute(
      sql`select * from draft_gen_context where shop_id = ${original.shopId} and generation_id = ${original.generationId}`,
    );
    expect(after.rows).toEqual(before.rows);
    expect(await capturePrototypeSighting(pg.connect(), event)).toBe("replayed");
    expect(await capturePrototypeSighting(pg.connect(), { ...next, eventId: event.eventId })).toBe(
      "key_reused",
    );
  });

  it("rotates the head while an earlier intake is uncommitted, then preserves that event", async () => {
    const pg = await postgresTestDb();
    await installGenerationPrototype(pg.db);
    const original = context();
    const next = { ...original, generationId: randomUUID(), meetingId: randomUUID() };
    const event = { ...original, eventId: randomUUID() };
    await seedGenerationPrototype(pg.db, original);
    const before = await pg.db.execute(
      sql`select * from draft_gen_context where shop_id = ${original.shopId} and generation_id = ${original.generationId}`,
    );
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const result = await work(tx);
              ready();
              await gate;
              return result;
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const intake = capturePrototypeSighting(delayed, event);
    void intake.catch(() => undefined);
    let reset: Promise<unknown> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([intake, ...(reset ? [reset] : [])]);
    });
    try {
      const reached = await arrivesBeforeRelease(
        Promise.race([
          held.then(() => "held" as const),
          intake.then(() => {
            throw new Error("intake did not hold");
          }),
        ]),
      );
      expect(reached).toBe("held");
      reset = pg.connect().transaction((tx) => rotatePrototypeGeneration(tx, original, next));
      expect(await arrivesBeforeRelease(reset.then(() => "committed" as const))).toBe("committed");
    } finally {
      release();
    }
    expect(await intake).toBe("recorded");
    const saved = await pg.db.execute(
      sql`select actor_id, trip_id, generation_id, meeting_id, booking_id from draft_gen_observation where shop_id = ${event.shopId} and event_id = ${event.eventId}`,
    );
    expect(saved.rows).toMatchObject([
      {
        actor_id: original.actorId,
        trip_id: original.tripId,
        generation_id: original.generationId,
        meeting_id: original.meetingId,
        booking_id: original.bookingId,
      },
    ]);
    const after = await pg.db.execute(
      sql`select * from draft_gen_context where shop_id = ${original.shopId} and generation_id = ${original.generationId}`,
    );
    expect(after.rows).toEqual(before.rows);
    await setPrototypeErased(pg.db, original.shopId, original.bookingId);
    expect(await capturePrototypeSighting(pg.connect(), event)).toBe("unavailable");
    const retained = await pg.db.execute(
      sql`select event_id from draft_gen_observation where shop_id = ${event.shopId} and event_id = ${event.eventId}`,
    );
    expect(retained.rows).toHaveLength(1);
    expect(await capturePrototypeSighting(pg.connect(), { ...event, shopId: randomUUID() })).toBe(
      "unavailable",
    );
  });
});
