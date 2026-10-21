import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { RetainedTable } from "@/lib/retention";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { isLockWaitRefusal } from "./lock-bounds";
import {
  initializeRetentionPruneState,
  PRUNE_ARMS,
  pruneExpiredRecords,
  reserveRetentionPruneTable,
} from "./retention";
import { retentionPruneState, stripeWebhookEvents } from "./schema";

const TABLES = Object.keys(PRUNE_ARMS) as RetainedTable[];
afterEach(() => vi.restoreAllMocks());

// These guarantees require separate server connections; PGlite cannot prove them.
// CI's real-postgres job automatically executes src/db/*.postgres.test.ts.
describePostgres("durable retention reservations", () => {
  it("initializes one singleton safely from concurrent callers", async () => {
    const pg = await postgresTestDb();
    const gate = await holdRowLock(pg, sql`lock table retention_prune_state in share mode`);
    const initializers = [
      initializeRetentionPruneState(pg.connect()),
      initializeRetentionPruneState(pg.connect()),
    ];
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    await Promise.all(initializers);
    expect(await pg.db.select().from(retentionPruneState)).toEqual([
      { id: "weekly", nextTable: TABLES[0] },
    ]);
  });

  it("overlapping locked reservations choose successive tables without a lost update", async () => {
    const pg = await postgresTestDb();
    await initializeRetentionPruneState(pg.db);
    const gate = await holdRowLock(
      pg,
      sql`select id from retention_prune_state where id = 'weekly' for update`,
    );
    const pending = new Set(TABLES);
    // Observe both parked on the state row before releasing: sequential success
    // alone would pass if the reservation lost its SELECT FOR UPDATE.
    const one = reserveRetentionPruneTable(pg.connect(), pending);
    const two = reserveRetentionPruneTable(pg.connect(), pending);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect((await Promise.all([one, two])).sort()).toEqual([TABLES[0], TABLES[1]].sort());
    expect(await pg.db.select().from(retentionPruneState)).toEqual([
      { id: "weekly", nextTable: TABLES[2] },
    ]);
  });

  it("wraps and skips arms outside the pending subset", async () => {
    const pg = await postgresTestDb();
    await pg.db.insert(retentionPruneState).values({ id: "weekly", nextTable: "incident_reports" });
    expect(await reserveRetentionPruneTable(pg.db, new Set(["integration_events"]))).toBe(
      TABLES[1],
    );
    expect(await pg.db.select().from(retentionPruneState)).toEqual([
      { id: "weekly", nextTable: TABLES[2] },
    ]);
  });

  it("a blocked destructive batch holds no state lock and progress survives independently", async () => {
    const pg = await postgresTestDb();
    await initializeRetentionPruneState(pg.db);
    await pg.db.insert(stripeWebhookEvents).values({
      id: "evt_slow",
      type: "account.updated",
      occurredAt: new Date("2020-01-01T00:00:00Z"),
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from stripe_webhook_events where id = 'evt_slow' for update`,
    );
    // Freeze admission time until the server proves the first delete is blocked.
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const run = pruneExpiredRecords(pg.connect(), {
      now: new Date("2026-08-03T00:00:00Z"),
      budgetMs: 10,
      batchLimit: 1,
    });
    await waitForLockWaiters(pg.db, 1);
    clock.mockReturnValue(10);
    // NOWAIT would throw while the state lock was held by the blocked batch.
    await pg.db.transaction(async (tx) => {
      const state = await tx.select().from(retentionPruneState).for("update", { noWait: true });
      expect(state).toEqual([{ id: "weekly", nextTable: TABLES[1] }]);
    });
    expect(await reserveRetentionPruneTable(pg.connect(), new Set(TABLES))).toBe(TABLES[1]);
    await gate.release();
    expect((await run).totalDeleted).toBe(1);
    expect(await pg.db.select().from(retentionPruneState)).toEqual([
      { id: "weekly", nextTable: TABLES[2] },
    ]);
  });

  it("a stuck cursor lock fails within the existing bound and admits no deletion", async () => {
    const pg = await postgresTestDb();
    await initializeRetentionPruneState(pg.db);
    await pg.db.insert(stripeWebhookEvents).values({
      id: "evt_held",
      type: "account.updated",
      occurredAt: new Date("2020-01-01T00:00:00Z"),
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from retention_prune_state where id = 'weekly' for update`,
    );
    // Initialization's ON CONFLICT is harmless for the already committed row;
    // the reservation's SELECT FOR UPDATE must be refused by lock_timeout.
    const started = performance.now();
    try {
      const failure = await pruneExpiredRecords(pg.connect(), {
        now: new Date("2026-08-03T00:00:00Z"),
      }).then(
        () => null,
        (error: unknown) => error,
      );
      // This helper checks SQLSTATE 55P03 through Drizzle's cause chain;
      // migration, type or arbitrary query failures must not satisfy the test.
      expect(isLockWaitRefusal(failure)).toBe(true);
      expect(performance.now() - started).toBeGreaterThanOrEqual(4_500);
    } finally {
      await gate.release();
    }
    expect(await pg.db.select().from(stripeWebhookEvents)).toHaveLength(1);
    expect(await pg.db.select().from(retentionPruneState)).toEqual([
      { id: "weekly", nextTable: TABLES[0] },
    ]);
  });
});
