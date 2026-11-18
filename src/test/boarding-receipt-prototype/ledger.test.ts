import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { createScratchLedger, recordScratchReceipt, type ScratchIntent } from "./ledger";

const first: ScratchIntent = {
  shopId: "shop-a",
  generationId: "generation-a",
  tripId: "trip-a",
  bookingId: "booking-a",
  actorId: "staff-a",
  eventId: "event-a",
  meeting: { kind: "known", id: "day-a" },
  occurredAt: "2026-11-18T10:00:00.000Z",
};

describe("scratch-only receipt ledger prototype", () => {
  it("retains both tap keys when two actors join an observation and one retries after settlement", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    const a = await recordScratchReceipt(db, first);
    const second = { ...first, eventId: "event-b", actorId: "staff-b" };
    const b = await recordScratchReceipt(db, second);
    expect(a).toMatchObject({ ok: true, replay: false });
    expect(b).toMatchObject({ ok: true, replay: false });
    if (!a.ok || !b.ok) throw new Error("prototype refused valid inputs");
    expect(b.observationId).toBe(a.observationId);
    await db.execute(
      sql`update scratch_observation set state = 'applied' where id = ${a.observationId}`,
    );
    expect(await recordScratchReceipt(db, second)).toEqual({
      ok: true,
      replay: true,
      observationId: a.observationId,
    });
    const receipts = await db.execute(
      sql`select event_id, actor_id from scratch_receipt order by event_id`,
    );
    expect(receipts.rows).toEqual([
      { event_id: "event-a", actor_id: "staff-a" },
      { event_id: "event-b", actor_id: "staff-b" },
    ]);
    const observations = await db.execute(sql`select id, state from scratch_observation`);
    expect(observations.rows).toEqual([{ id: a.observationId, state: "applied" }]);
  });

  it("refuses a reused key with changed intent without creating a second observation", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    expect(await recordScratchReceipt(db, first)).toMatchObject({ ok: true });
    expect(await recordScratchReceipt(db, { ...first, bookingId: "booking-b" })).toEqual({
      ok: false,
      reason: "key_reused",
    });
    const observations = await db.execute(sql`select booking_id from scratch_observation`);
    expect(observations.rows).toEqual([{ booking_id: "booking-a" }]);
  });

  it("rejects changes to the original context under an already reserved key", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    expect(await recordScratchReceipt(db, first)).toMatchObject({ ok: true });
    const changes: Partial<ScratchIntent>[] = [
      { generationId: "generation-b" },
      { tripId: "trip-b" },
      { bookingId: "booking-b" },
      { actorId: "staff-b" },
      { meeting: { kind: "known", id: "day-b" } },
      { meeting: { kind: "unknown" } },
      { occurredAt: "2026-11-18T10:01:00.000Z" },
    ];
    for (const change of changes) {
      expect(await recordScratchReceipt(db, { ...first, ...change })).toEqual({
        ok: false,
        reason: "key_reused",
      });
    }
    expect((await db.execute(sql`select * from scratch_receipt`)).rows).toHaveLength(1);
    expect((await db.execute(sql`select * from scratch_observation`)).rows).toHaveLength(1);
  });

  it("isolates the same event key between synthetic tenants", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    const a = await recordScratchReceipt(db, first);
    const b = await recordScratchReceipt(db, { ...first, shopId: "shop-b" });
    if (!a.ok || !b.ok) throw new Error("prototype refused valid tenant-scoped inputs");
    expect(a.observationId).not.toBe(b.observationId);
    expect((await db.execute(sql`select * from scratch_receipt`)).rows).toHaveLength(2);
  });

  it("does not coalesce an unknown meeting with a known or another unknown meeting", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    const a = await recordScratchReceipt(db, first);
    const b = await recordScratchReceipt(db, {
      ...first,
      eventId: "event-b",
      meeting: { kind: "unknown" },
    });
    const c = await recordScratchReceipt(db, {
      ...first,
      eventId: "event-c",
      meeting: { kind: "unknown" },
    });
    if (!a.ok || !b.ok || !c.ok) throw new Error("prototype refused valid inputs");
    expect(new Set([a.observationId, b.observationId, c.observationId]).size).toBe(3);
  });

  it("rolls back an event-key reservation when the transaction fails before its observation", async () => {
    const db = await unseededTestDb();
    await createScratchLedger(db);
    await expect(
      recordScratchReceipt(db, first, {
        afterReservation: async () => {
          throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow("injected failure");
    expect((await db.execute(sql`select * from scratch_receipt`)).rows).toEqual([]);
    expect((await db.execute(sql`select * from scratch_observation`)).rows).toEqual([]);
    expect(await recordScratchReceipt(db, first)).toMatchObject({ ok: true, replay: false });
  });
});
