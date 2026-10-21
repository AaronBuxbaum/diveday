import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { RETENTION_DAYS, type RetainedTable } from "@/lib/retention";
import { unseededTestDb } from "@/test/db";
import { PRUNE_ARMS, PRUNE_TIME_BUDGET_MS, pruneExpiredRecords } from "./retention";
import { notificationSendQueue, retentionPruneState, shops, stripeWebhookEvents } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");
const STALE = new Date(NOW.getTime() - (RETENTION_DAYS.stripe_webhook_events + 1) * DAY_MS);
const TABLES = Object.keys(PRUNE_ARMS) as RetainedTable[];
let db: AppDb;

// Fresh committed database: a file-scoped rollback transaction would hide the
// commit-before-delete/restart guarantee these tests assert directly.
beforeEach(async () => {
  db = await unseededTestDb();
});
afterEach(() => vi.restoreAllMocks());

async function backlog(count: number) {
  await db.insert(stripeWebhookEvents).values(
    Array.from({ length: count }, (_, index) => ({
      id: `evt_backlog_${index}`,
      type: "account.updated",
      account: "acct_1",
      occurredAt: STALE,
    })),
  );
}

function webhookOutcome(summary: Awaited<ReturnType<typeof pruneExpiredRecords>>) {
  const outcome = summary.outcomes.find((row) => row.table === "stripe_webhook_events");
  if (!outcome) throw new Error("no outcome for stripe_webhook_events");
  return outcome;
}

/** Real SQL still executes; the query logger only observes admission boundaries. */
function caller(observe: (query: string) => void): AppDb {
  return drizzle({ client: db.$client, logger: { logQuery: observe } });
}

function batchTable(query: string): RetainedTable | undefined {
  if (!query.startsWith("select ")) return;
  return TABLES.find((table) => query.includes(`from "${table}"`));
}

async function nextTable() {
  return (await db.select().from(retentionPruneState))[0]?.nextTable;
}

describe("pruneExpiredRecords under a time budget", () => {
  it("drains deeper than one batch and does not revisit completed arms", async () => {
    await backlog(7);
    const visited: RetainedTable[] = [];
    const summary = await pruneExpiredRecords(
      caller((query) => {
        const table = batchTable(query);
        if (table) visited.push(table);
      }),
      { now: NOW, batchLimit: 2 },
    );
    expect(webhookOutcome(summary)).toMatchObject({
      deleted: 7,
      capped: false,
      failed: false,
      skipped: false,
    });
    expect(await db.select().from(stripeWebhookEvents)).toEqual([]);
    expect(visited.filter((table) => table === "stripe_webhook_events")).toHaveLength(4);
    expect(visited.filter((table) => table === "integration_events")).toHaveLength(1);
    expect(summary.outcomes.map((outcome) => outcome.table)).toEqual(TABLES);
    expect(summary.skippedTables).toEqual([]);
  });

  it("rechecks age at deletion and revisits a full candidate batch that deleted nothing", async () => {
    await backlog(2);
    // PGlite queues both real queries on one connection. Queue a competing
    // update at DELETE's logging boundary, before that statement reaches the DB.
    const changes: Promise<unknown>[] = [];
    let refreshed = false;
    let batches = 0;
    const summary = await pruneExpiredRecords(
      caller((query) => {
        if (batchTable(query) === "stripe_webhook_events") batches += 1;
        if (!refreshed && query.startsWith('delete from "stripe_webhook_events"')) {
          refreshed = true;
          changes.push(
            db.$client.query("update stripe_webhook_events set occurred_at = $1 where id = $2", [
              NOW,
              "evt_backlog_0",
            ]),
          );
        }
      }),
      { now: NOW, batchLimit: 1 },
    );
    await Promise.all(changes);
    expect(webhookOutcome(summary)).toMatchObject({ deleted: 1, capped: false, failed: false });
    expect(batches).toBe(3);
    expect(await db.select().from(stripeWebhookEvents)).toMatchObject([
      { id: "evt_backlog_0", occurredAt: NOW },
    ]);
    expect(
      await db
        .select()
        .from(stripeWebhookEvents)
        .where(eq(stripeWebhookEvents.id, "evt_backlog_1")),
    ).toEqual([]);
  });

  it("rechecks extra eligibility when a completed send becomes queued before deletion", async () => {
    const [shop] = await db
      .insert(shops)
      .values({ name: "Retention", slug: "retention", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [send] = await db
      .insert(notificationSendQueue)
      .values({
        shopId: shop.id,
        idempotencyKey: "retention-send",
        status: "sent",
        nextAttemptAt: STALE,
        updatedAt: STALE,
      })
      .returning();
    if (!send) throw new Error("send missing");
    await db
      .insert(retentionPruneState)
      .values({ id: "weekly", nextTable: "notification_send_queue" });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const changes: Promise<unknown>[] = [];
    const summary = await pruneExpiredRecords(
      caller((query) => {
        if (query.startsWith('delete from "notification_send_queue"')) {
          changes.push(
            db.$client.query("update notification_send_queue set status = 'queued' where id = $1", [
              send.id,
            ]),
          );
          clock = 10;
        }
      }),
      { now: NOW, budgetMs: 10, batchLimit: 1 },
    );
    await Promise.all(changes);
    expect(
      summary.outcomes.find((outcome) => outcome.table === "notification_send_queue"),
    ).toMatchObject({ deleted: 0, capped: true, failed: false, skipped: false });
    expect(await db.select().from(notificationSendQueue)).toMatchObject([
      { id: send.id, status: "queued" },
    ]);
  });

  it("admits no table work with zero budget and reports unknown eligibility", async () => {
    await backlog(7);
    const queries: string[] = [];
    const summary = await pruneExpiredRecords(
      caller((query) => queries.push(query)),
      { now: NOW, budgetMs: 0 },
    );
    expect(queries).toEqual([]);
    expect(
      summary.outcomes.every(
        (outcome) => outcome.skipped && !outcome.capped && !outcome.failed && outcome.deleted === 0,
      ),
    ).toBe(true);
    expect(summary.skippedTables).toEqual(TABLES);
    expect(await db.select().from(stripeWebhookEvents)).toHaveLength(7);
    expect(await nextTable()).toBeUndefined();
  });

  it.each([45_000, 45_001])(
    "admits no second batch when the first ends at elapsed %i",
    async (elapsed) => {
      await backlog(3);
      // A second real table has stale data too: it must survive untouched.
      await db.execute(
        sql`insert into demo_entries (entered_at, source, role) values ('2020-01-01', 'organic', 'owner')`,
      );
      let clock = 0;
      const visited: RetainedTable[] = [];
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const summary = await pruneExpiredRecords(
        caller((query) => {
          const table = batchTable(query);
          if (table) visited.push(table);
          if (query.startsWith('delete from "stripe_webhook_events"')) clock = elapsed;
        }),
        { now: NOW, batchLimit: 2, budgetMs: 45_000 },
      );
      expect(visited).toEqual(["stripe_webhook_events"]);
      expect(webhookOutcome(summary)).toMatchObject({ deleted: 2, capped: true, skipped: false });
      expect(summary.skippedTables).toEqual(TABLES.slice(1));
      expect(await db.select().from(stripeWebhookEvents)).toHaveLength(1);
      const result = await db.execute(sql`select count(*)::int as count from demo_entries`);
      expect(result.rows[0]).toMatchObject({ count: 1 });
      expect(await nextTable()).toBe("integration_events");
    },
  );

  it("checks the deadline again after reservation commits", async () => {
    await backlog(3);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const visited: RetainedTable[] = [];
    const summary = await pruneExpiredRecords(
      caller((query) => {
        if (query.startsWith('update "retention_prune_state"')) clock = 10;
        const table = batchTable(query);
        if (table) visited.push(table);
      }),
      { now: NOW, budgetMs: 10 },
    );
    expect(visited).toEqual([]);
    expect(summary.skippedTables).toEqual(TABLES);
    expect(await nextTable()).toBe("integration_events");
    expect(await db.select().from(stripeWebhookEvents)).toHaveLength(3);
  });

  it("stops admissions within a later round too", async () => {
    await backlog(5);
    await db.execute(
      sql`insert into demo_entries (entered_at, source, role) values ('2020-01-01', 'organic', 'owner'), ('2020-01-02', 'organic', 'owner')`,
    );
    let clock = 0;
    let webhookBatches = 0;
    const visited: RetainedTable[] = [];
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const summary = await pruneExpiredRecords(
      caller((query) => {
        const table = batchTable(query);
        if (table) visited.push(table);
        if (query.startsWith('delete from "stripe_webhook_events"') && ++webhookBatches === 2)
          clock = 10;
      }),
      { now: NOW, batchLimit: 1, budgetMs: 10 },
    );
    expect(visited).toEqual([...TABLES, "stripe_webhook_events"]);
    expect(webhookOutcome(summary)).toMatchObject({ deleted: 2, capped: true });
    expect(summary.outcomes.find((outcome) => outcome.table === "demo_entries")).toMatchObject({
      deleted: 1,
      capped: true,
    });
    expect(summary.skippedTables).toEqual([]);
  });

  it("fresh callers at the same application instant resume every canonical arm", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    for (const [index, expected] of TABLES.entries()) {
      clock = 0;
      const visited: RetainedTable[] = [];
      const summary = await pruneExpiredRecords(
        caller((query) => {
          const table = batchTable(query);
          if (table) {
            visited.push(table);
            clock = 10;
          }
        }),
        { now: NOW, budgetMs: 10 },
      );
      expect(visited).toEqual([expected]);
      expect(
        summary.outcomes.filter((outcome) => !outcome.skipped).map((outcome) => outcome.table),
      ).toEqual([expected]);
      expect(await nextTable()).toBe(TABLES[(index + 1) % TABLES.length]);
    }
  });

  it("termination after a committed reservation preserves priority for a fresh invocation", async () => {
    await backlog(1);
    let terminated = false;
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (terminated) throw new Error("platform_terminated");
      return 0;
    });
    await expect(
      pruneExpiredRecords(
        caller((query) => {
          if (query.startsWith('update "retention_prune_state"')) terminated = true;
        }),
        { now: NOW },
      ),
    ).rejects.toThrow("platform_terminated");
    expect(await nextTable()).toBe("integration_events");
    expect(await db.select().from(stripeWebhookEvents)).toHaveLength(1);
    vi.restoreAllMocks();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const visited: RetainedTable[] = [];
    await pruneExpiredRecords(
      caller((query) => {
        const table = batchTable(query);
        if (table) {
          visited.push(table);
          clock = 10;
        }
      }),
      { now: NOW, budgetMs: 10 },
    );
    expect(visited).toEqual(["integration_events"]);
  });

  it("keeps successful deletion counts after a later batch fails and never retries the failed arm", async () => {
    await backlog(2);
    await db.execute(
      sql`create function reject_second_webhook() returns trigger language plpgsql as $$ begin if old.id = 'evt_backlog_1' then raise exception 'test_delete_failure'; end if; return old; end $$`,
    );
    await db.execute(
      sql`create trigger fail_webhook before delete on stripe_webhook_events for each row execute function reject_second_webhook()`,
    );
    let batches = 0;
    const summary = await pruneExpiredRecords(
      caller((query) => {
        if (batchTable(query) === "stripe_webhook_events") batches += 1;
      }),
      { now: NOW, batchLimit: 1 },
    );
    expect(webhookOutcome(summary)).toMatchObject({
      deleted: 1,
      failed: true,
      capped: false,
      skipped: false,
    });
    expect(summary.totalDeleted).toBe(1);
    expect(summary.failedTables).toEqual(["stripe_webhook_events"]);
    expect(batches).toBe(2);
    expect(await nextTable()).toBe("integration_events");
    expect(await db.select().from(stripeWebhookEvents)).toHaveLength(1);
  });

  it("recovers an unknown cursor code", async () => {
    await db.insert(retentionPruneState).values({ id: "weekly", nextTable: "removed_table" });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const visited: RetainedTable[] = [];
    await pruneExpiredRecords(
      caller((query) => {
        const table = batchTable(query);
        if (table) {
          visited.push(table);
          clock = 10;
        }
      }),
      { now: NOW, budgetMs: 10 },
    );
    expect(visited).toEqual([TABLES[0]]);
    expect(await nextTable()).toBe("integration_events");
  });

  it("a checkpoint access failure admits no table batch", async () => {
    await backlog(1);
    await db.execute(sql`drop table retention_prune_state`);
    const visited: RetainedTable[] = [];
    await expect(
      pruneExpiredRecords(
        caller((query) => {
          const table = batchTable(query);
          if (table) visited.push(table);
        }),
        { now: NOW },
      ),
    ).rejects.toThrow();
    expect(visited).toEqual([]);
    expect(await db.select().from(stripeWebhookEvents)).toHaveLength(1);
  });

  it("enforces both singleton identity and primary-key uniqueness", async () => {
    await db
      .insert(retentionPruneState)
      .values({ id: "weekly", nextTable: "stripe_webhook_events" });
    await expect(
      db.insert(retentionPruneState).values({ id: "other", nextTable: "stripe_webhook_events" }),
    ).rejects.toThrow();
    await expect(
      db.insert(retentionPruneState).values({ id: "weekly", nextTable: "stripe_webhook_events" }),
    ).rejects.toThrow();
    expect(await db.select().from(retentionPruneState)).toHaveLength(1);
  });

  it("leaves the route's last quarter minute for in-flight work and reporting", () => {
    expect(PRUNE_TIME_BUDGET_MS).toBe(45_000);
  });
});
