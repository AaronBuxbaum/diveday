import { describe, expect, it } from "vitest";
import {
  PRUNE_BATCH_LIMIT,
  RETENTION_DAYS,
  type RetainedTable,
  retentionCutoff,
  retentionWindowsOutlastStripeRetries,
  STRIPE_WEBHOOK_RETRY_DAYS,
} from "./retention";

const NOW = new Date("2026-08-03T00:00:00.000Z");

describe("retention windows", () => {
  // The hazard the review named explicitly (PAY-L2): a `stripe_webhook_events`
  // row is not just dedup state, it is the chronological evidence
  // `hasNewerAccountUpdate` reads. Pruning inside Stripe's own retry horizon
  // would let an older `account.updated` redelivery read as fresh and regress
  // `charges_enabled` — fail-open on the flag that gates order and checkout
  // creation. Asserted, not merely commented, so shortening it fails a test.
  it("keeps Stripe webhook evidence far longer than Stripe's own retry window", () => {
    expect(retentionWindowsOutlastStripeRetries()).toBe(true);
    expect(RETENTION_DAYS.stripe_webhook_events).toBeGreaterThan(STRIPE_WEBHOOK_RETRY_DAYS * 100);
  });

  it("refuses a safety factor the configured window cannot meet", () => {
    // Guards the guard: the helper must actually be sensitive to its argument,
    // rather than returning true for anything.
    expect(retentionWindowsOutlastStripeRetries(1_000)).toBe(false);
  });

  it("states a positive window for every retained table", () => {
    const tables = Object.keys(RETENTION_DAYS) as RetainedTable[];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(RETENTION_DAYS[table]).toBeGreaterThan(0);
      expect(Number.isInteger(RETENTION_DAYS[table])).toBe(true);
    }
  });

  // The money ledger DATA-M3 exists to provide must outlive the operational
  // trails; a shorter window there would quietly defeat the point of the table.
  it("keeps the local money ledger longest", () => {
    const others = (Object.keys(RETENTION_DAYS) as RetainedTable[]).filter(
      (table) => table !== "booking_payment_events",
    );
    for (const table of others) {
      expect(RETENTION_DAYS.booking_payment_events).toBeGreaterThan(RETENTION_DAYS[table]);
    }
  });

  it("computes a cutoff that many days back", () => {
    const cutoff = retentionCutoff("account_tokens", NOW);
    const days = (NOW.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(RETENTION_DAYS.account_tokens);
  });

  it("bounds one pass so a backlog converges instead of timing out", () => {
    expect(PRUNE_BATCH_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(PRUNE_BATCH_LIMIT)).toBe(true);
  });
});
