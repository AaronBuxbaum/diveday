import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  addPrototypeContext,
  capturePrototypeSighting,
  installGenerationPrototype,
  rotatePrototypeGeneration,
  seedGenerationPrototype,
  setPrototypeErased,
} from "./generation-store";

it("preserves immutable context, rejects cross-tenant and erased new capture, and keeps prior evidence", async () => {
  const db = await unseededTestDb();
  await installGenerationPrototype(db);
  const context = {
    shopId: randomUUID(),
    actorId: randomUUID(),
    tripId: randomUUID(),
    bookingId: randomUUID(),
    generationId: randomUUID(),
    meetingId: randomUUID(),
  };
  await seedGenerationPrototype(db, context);
  await expect(
    addPrototypeContext(db, { ...context, tripId: randomUUID(), bookingId: randomUUID() }),
  ).rejects.toThrow();
  const secondSeat = { ...context, bookingId: randomUUID() };
  const secondDay = { ...context, meetingId: randomUUID() };
  await addPrototypeContext(db, secondSeat);
  await addPrototypeContext(db, secondDay);
  expect(await capturePrototypeSighting(db, { ...secondSeat, eventId: randomUUID() })).toBe(
    "recorded",
  );
  expect(await capturePrototypeSighting(db, { ...secondDay, eventId: randomUUID() })).toBe(
    "recorded",
  );
  const badHead = { ...context, generationId: randomUUID() };
  const uncommitted = { ...context, generationId: randomUUID(), meetingId: randomUUID() };
  await expect(
    db.transaction((tx) => rotatePrototypeGeneration(tx, badHead, uncommitted)),
  ).rejects.toThrow("stale prototype head");
  expect(
    (
      await db.execute(
        sql`select * from draft_gen_context where shop_id = ${context.shopId} and generation_id = ${uncommitted.generationId}`,
      )
    ).rows,
  ).toEqual([]);
  const event = { ...context, eventId: randomUUID() };
  expect(await capturePrototypeSighting(db, event)).toBe("recorded");
  expect(await capturePrototypeSighting(db, event)).toBe("replayed");
  expect(await capturePrototypeSighting(db, { ...event, bookingId: randomUUID() })).toBe(
    "unavailable",
  );
  expect(await capturePrototypeSighting(db, { ...event, shopId: randomUUID() })).toBe(
    "unavailable",
  );
  await setPrototypeErased(db, context.shopId, context.bookingId);
  expect(await capturePrototypeSighting(db, event)).toBe("unavailable");
  const retained = await db.execute(
    sql`select event_id, generation_id, meeting_id from draft_gen_observation where shop_id = ${event.shopId} and event_id = ${event.eventId}`,
  );
  expect(retained.rows).toMatchObject([
    { event_id: event.eventId, generation_id: event.generationId, meeting_id: event.meetingId },
  ]);
});
