import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import type { RetainedTable } from "@/lib/retention";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { setIncidentLegalHold } from "./incident-reports";
import { isLockWaitRefusal } from "./lock-bounds";
import {
  initializeRetentionPruneState,
  PRUNE_ARMS,
  pruneExpiredRecords,
  reserveRetentionPruneTable,
} from "./retention";
import {
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  people,
  personRoles,
  retentionPruneState,
  shops,
  stripeWebhookEvents,
  trips,
  userAccounts,
} from "./schema";

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
    // Observe rejection immediately, even while the concurrency barrier waits.
    const settled = Promise.allSettled(initializers);
    try {
      await waitForLockWaiters(pg.db, 2);
      await gate.release();
      await Promise.all(initializers);
      expect(await pg.db.select().from(retentionPruneState)).toEqual([
        { id: "weekly", nextTable: TABLES[0] },
      ]);
    } finally {
      try {
        await gate.release();
      } finally {
        await settled;
      }
    }
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
    const settled = Promise.allSettled([one, two]);
    try {
      await waitForLockWaiters(pg.db, 2);
      await gate.release();
      expect((await Promise.all([one, two])).sort()).toEqual([TABLES[0], TABLES[1]].sort());
      expect(await pg.db.select().from(retentionPruneState)).toEqual([
        { id: "weekly", nextTable: TABLES[2] },
      ]);
    } finally {
      try {
        await gate.release();
      } finally {
        await settled;
      }
    }
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
    const settled = Promise.allSettled([run]);
    try {
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
    } finally {
      clock.mockReturnValue(10);
      try {
        await gate.release();
      } finally {
        await settled;
      }
    }
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

describePostgres("retention eligibility at mutation time", () => {
  it("preserves an owner's committed legal hold and its child evidence after candidate selection", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: "Retention Race",
        slug: "retention-race",
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Owner",
      })
      .returning();
    if (!owner) throw new Error("owner missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db.insert(userAccounts).values({ personId: owner.id, email: "owner@example.com" });
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Incident departure",
        capacity: 12,
        startsAt: new Date("2018-01-01T08:00:00Z"),
        endsAt: new Date("2018-01-01T12:00:00Z"),
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    const [report] = await pg.db
      .insert(incidentReports)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        createdByPersonId: owner.id,
        occurredAt: new Date("2018-01-01T10:00:00Z"),
      })
      .returning();
    if (!report) throw new Error("report missing");
    await pg.db.insert(incidentReportPeople).values({
      shopId: shop.id,
      reportId: report.id,
      personId: owner.id,
      involvement: "witness",
    });
    await pg.db.insert(incidentReportAddenda).values({
      shopId: shop.id,
      reportId: report.id,
      authorPersonId: owner.id,
      body: "Preserve this evidence.",
    });
    await pg.db.insert(retentionPruneState).values({ id: "weekly", nextTable: "incident_reports" });
    const gate = await holdRowLock(pg, sql`lock table activity_events in share mode`);
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const hold = setIncidentLegalHold(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      reportId: report.id,
      actorPersonId: owner.id,
      held: true,
    });
    // Observe early rejection while a lock barrier is still waiting. Original
    // promises remain the source of the success assertions below.
    const settled: Promise<unknown>[] = [Promise.allSettled([hold])];
    let prune: ReturnType<typeof pruneExpiredRecords> | undefined;
    try {
      // The owner has updated the hold but cannot commit its required activity INSERT.
      await waitForLockWaiters(pg.db, 1);
      prune = pruneExpiredRecords(pg.connect(), {
        now: new Date("2026-08-03T00:00:00Z"),
        budgetMs: 10,
        batchLimit: 1,
      });
      settled.push(Promise.allSettled([prune]));
      // The plain candidate SELECT saw the old version; DELETE waits on the owner's row lock.
      await waitForLockWaiters(pg.db, 2);
      clock.mockReturnValue(10);
    } finally {
      clock.mockReturnValue(10);
      try {
        await gate.release();
      } finally {
        await Promise.all(settled);
      }
    }
    expect(await hold).toEqual({ ok: true });
    if (!prune) throw new Error("prune never started");
    const summary = await prune;
    expect(summary.failedTables).toEqual([]);
    expect(summary.totalDeleted).toBe(0);
    expect(summary.outcomes.find((outcome) => outcome.table === "incident_reports")).toMatchObject({
      deleted: 0,
      capped: true,
      failed: false,
      skipped: false,
    });
    const [remaining] = await pg.db
      .select()
      .from(incidentReports)
      .where(eq(incidentReports.id, report.id));
    expect(remaining?.legalHoldAt).toBeInstanceOf(Date);
    expect(await pg.db.select().from(incidentReportPeople)).toHaveLength(1);
    expect(await pg.db.select().from(incidentReportAddenda)).toHaveLength(1);
  });

  it("counts one actual deletion across overlapping sweeps of the same candidate", async () => {
    const pg = await postgresTestDb();
    await initializeRetentionPruneState(pg.db);
    await pg.db.insert(stripeWebhookEvents).values({
      id: "evt_overlap",
      type: "account.updated",
      occurredAt: new Date("2020-01-01T00:00:00Z"),
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from stripe_webhook_events where id = 'evt_overlap' for update`,
    );
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const first = pruneExpiredRecords(pg.connect(), {
      now: new Date("2026-08-03T00:00:00Z"),
      budgetMs: 10,
      batchLimit: 1,
    });
    const settled: Promise<unknown>[] = [Promise.allSettled([first])];
    let second: ReturnType<typeof pruneExpiredRecords> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      // Reset priority so the second caller reaches precisely the same candidate.
      await pg.db.update(retentionPruneState).set({ nextTable: "stripe_webhook_events" });
      second = pruneExpiredRecords(pg.connect(), {
        now: new Date("2026-08-03T00:00:00Z"),
        budgetMs: 10,
        batchLimit: 1,
      });
      settled.push(Promise.allSettled([second]));
      await waitForLockWaiters(pg.db, 2);
      clock.mockReturnValue(10);
    } finally {
      clock.mockReturnValue(10);
      try {
        await gate.release();
      } finally {
        await Promise.all(settled);
      }
    }
    if (!second) throw new Error("second sweep never started");
    const summaries = await Promise.all([first, second]);
    expect(summaries.map((summary) => summary.totalDeleted).sort()).toEqual([0, 1]);
    expect(summaries.every((summary) => summary.failedTables.length === 0)).toBe(true);
    expect(await pg.db.select().from(stripeWebhookEvents)).toEqual([]);
  });
});
