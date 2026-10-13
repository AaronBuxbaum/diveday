import { describe, expect, it } from "vitest";
import { RETENTION_DAYS } from "@/lib/retention";
import { fileScopedShopContext } from "@/test/db";
import { PRUNE_TIME_BUDGET_MS, pruneExpiredRecords } from "./retention";
import { stripeWebhookEvents } from "./schema";

/**
 * A run keeps draining a table over its window until it is inside it or the
 * time budget is spent (fourth review, row 18). Until 2026-10-13 a run took one
 * batch per table, so a table gaining more than a batch a week never caught up.
 * `batchLimit` is shrunk here so a backlog is a handful of rows, not 5,000.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");
const STALE = new Date(NOW.getTime() - (RETENTION_DAYS.stripe_webhook_events + 1) * DAY_MS);

const ctx = fileScopedShopContext();

async function backlog(count: number) {
  await ctx.db.insert(stripeWebhookEvents).values(
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

describe("pruneExpiredRecords under a time budget", () => {
  it("drains a backlog deeper than one batch in a single run", async () => {
    await backlog(7);
    const summary = await pruneExpiredRecords(ctx.db, { now: NOW, batchLimit: 2 });
    expect(webhookOutcome(summary)).toMatchObject({ deleted: 7, capped: false, failed: false });
    expect(await ctx.db.select().from(stripeWebhookEvents)).toEqual([]);
  });

  it("stops at the budget and says the table is still capped", async () => {
    await backlog(7);
    // A spent budget: one round, one batch per table, as before the loop.
    const summary = await pruneExpiredRecords(ctx.db, { now: NOW, batchLimit: 2, budgetMs: 0 });
    expect(webhookOutcome(summary)).toMatchObject({ deleted: 2, capped: true });
    expect(await ctx.db.select().from(stripeWebhookEvents)).toHaveLength(5);
  });

  it("reports one outcome per table, however many rounds it took", async () => {
    await backlog(5);
    const summary = await pruneExpiredRecords(ctx.db, { now: NOW, batchLimit: 2 });
    const tables = summary.outcomes.map((row) => row.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(summary.totalDeleted).toBeGreaterThanOrEqual(5);
  });

  it("leaves the route's last quarter minute for the batch in flight and the log line", () => {
    expect(PRUNE_TIME_BUDGET_MS).toBe(45_000);
  });
});
