import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDb, createTestDb } from "@/db/client";
import { claimUsageAlert, releaseUsageAlert } from "./alert-ledger";

/**
 * The dedup that makes this a once-per-period alert rather than a daily one.
 *
 * Worth stating why it exists at all, because the obvious reading of
 * `sendNotification` says it should not have to: `notification_send_queue`'s
 * unique `idempotency_key` only ever sees a row when a send *fails* and is
 * retryable. A successful send writes nothing, so nothing there suppresses
 * tomorrow's identical alert. This does.
 *
 * One database for the whole file rather than one per test: every case uses its
 * own key, so they cannot see each other, and standing up an embedded Postgres
 * six times costs ~250MB and several seconds each for no isolation this file
 * actually needs.
 */

let db: AppDb;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await (db.$client as PGlite).close();
});

const periodEnd = new Date("2026-09-01T00:00:00.000Z");
const now = new Date("2026-08-06T09:00:00.000Z");

describe("claimUsageAlert", () => {
  it("grants the first claim on a key", async () => {
    expect(await claimUsageAlert(db, "usage-ceiling/first/2026-08/warn", periodEnd, now)).toBe(
      true,
    );
  });

  it("refuses a second claim inside the same period", async () => {
    const key = "usage-ceiling/repeat/2026-08/warn";
    expect(await claimUsageAlert(db, key, periodEnd, now)).toBe(true);
    // Tomorrow's cron pass, same ceiling, same period, same level.
    expect(await claimUsageAlert(db, key, periodEnd, new Date("2026-08-07T09:00:00.000Z"))).toBe(
      false,
    );
    // And every remaining day of the month.
    expect(await claimUsageAlert(db, key, periodEnd, new Date("2026-08-31T09:00:00.000Z"))).toBe(
      false,
    );
  });

  it("grants the claim again once the period has rolled over", async () => {
    const key = "usage-ceiling/rollover/2026-08/warn";
    expect(await claimUsageAlert(db, key, periodEnd, now)).toBe(true);
    // The instant the claim expires is the instant it becomes re-claimable —
    // the condition is `next_allowed_at <= now`, so the boundary is inclusive.
    expect(await claimUsageAlert(db, key, periodEnd, periodEnd)).toBe(true);
  });

  it("keeps different ceilings, periods, and levels independent", async () => {
    expect(
      await claimUsageAlert(db, "usage-ceiling/vercel_spend/2026-08/warn", periodEnd, now),
    ).toBe(true);
    // Escalating from warn to over is different news and must not be swallowed.
    expect(
      await claimUsageAlert(db, "usage-ceiling/vercel_spend/2026-08/over", periodEnd, now),
    ).toBe(true);
    expect(
      await claimUsageAlert(db, "usage-ceiling/neon_compute/2026-08/warn", periodEnd, now),
    ).toBe(true);
    expect(
      await claimUsageAlert(db, "usage-ceiling/vercel_spend/2026-09/warn", periodEnd, now),
    ).toBe(true);
  });
});

describe("releaseUsageAlert", () => {
  it("lets the next pass try again after a send that never landed", async () => {
    const key = "usage-ceiling/released/2026-08/warn";
    expect(await claimUsageAlert(db, key, periodEnd, now)).toBe(true);
    await releaseUsageAlert(db, key);
    // Without the release, a single SES hiccup would cost this ceiling its
    // entire month of alerting while looking perfectly healthy.
    expect(await claimUsageAlert(db, key, periodEnd, now)).toBe(true);
  });

  it("is harmless on a key that was never claimed", async () => {
    await expect(
      releaseUsageAlert(db, "usage-ceiling/never/2026-08/warn"),
    ).resolves.toBeUndefined();
  });
});
