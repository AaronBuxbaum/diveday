import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { recordPreDepartureCheck } from "./pre-departure-check";
import { preDepartureCheckEvents, preDepartureChecklistItems } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A resent checklist sync, overlapping the request it gave up on** (layer 1
 * re-review, R3). The sibling of `roll-call.postgres.test.ts`'s overlap
 * suite, for the writer that took a trip lock in the same change.
 *
 * The device abandons a sync at `SYNC_TIMEOUT_MS` and resends the same
 * `clientEventId`; the abandoned request is still running here. Before the
 * trip lock and the second question under it, the replay asked "is this id
 * recorded?" while the first request was uncommitted, and then read that
 * request's own row as the newest one: a replayed `cleared` was refused as
 * `retraction_superseded`.
 *
 * **The gate.** A third connection holds the recorder's `people` row
 * `FOR UPDATE`. The first request inserts its event and parks on that row in
 * the insert's own foreign-key check: written, not committed, holding the
 * trip lock. The replay is started only after that, and released only once
 * Postgres reports it parked too.
 */
const MINUTE_MS = 60_000;

async function aChecklistLineOnTheReef(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [item] = await db
    .select({ id: preDepartureChecklistItems.id })
    .from(preDepartureChecklistItems)
    .where(
      and(
        eq(preDepartureChecklistItems.shopId, shop.id),
        isNull(preDepartureChecklistItems.deletedAt),
      ),
    )
    .limit(1);
  if (!item) throw new Error("the demo shop has no pre-departure checklist");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { shopId: shop.id, tripId: reef.id, checklistItemId: item.id, staffId: staff.person.id };
}

function offlineEvent(minutesAfterSave: number) {
  const savedAt = new Date(nowMs() - 10 * MINUTE_MS);
  return {
    source: "offline" as const,
    clientEventId: crypto.randomUUID(),
    offlineSnapshotSavedAt: savedAt,
    occurredAt: new Date(savedAt.getTime() + minutesAfterSave * MINUTE_MS),
  };
}

async function rowsCarrying(db: AppDb, clientEventId: string): Promise<number> {
  const rows = await db
    .select({ id: preDepartureCheckEvents.id })
    .from(preDepartureCheckEvents)
    .where(eq(preDepartureCheckEvents.clientEventId, clientEventId));
  return rows.length;
}

describePostgres("a resent checklist sync overlapping the request it gave up on", () => {
  it("answers a replayed un-check as a duplicate, never as superseded", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, checklistItemId, staffId } = await aChecklistLineOnTheReef(pg.db);
    const common = { shopId, tripId, checklistItemId, recordedByPersonId: staffId };
    const checked = offlineEvent(1);
    await expect(
      recordPreDepartureCheck(pg.db, { ...common, ...checked, status: "checked" }),
    ).resolves.toMatchObject({ ok: true });
    const undo = {
      ...common,
      ...offlineEvent(2),
      status: "cleared" as const,
      retractsClientEventId: checked.clientEventId,
    };

    const gate = await holdRowLock(pg, sql`select id from people where id = ${staffId} for update`);
    const first = recordPreDepartureCheck(pg.connect(), undo);
    await waitForLockWaiters(pg.db, 1);
    const replay = recordPreDepartureCheck(pg.connect(), undo);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [firstResult, replayResult] = await Promise.all([first, replay]);

    expect(firstResult).toMatchObject({ ok: true });
    expect(firstResult.ok && firstResult.duplicate).toBeFalsy();
    expect(replayResult).toEqual({
      ok: true,
      eventId: firstResult.ok ? firstResult.eventId : "",
      duplicate: true,
    });
    expect(await rowsCarrying(pg.db, undo.clientEventId)).toBe(1);
  });
});
