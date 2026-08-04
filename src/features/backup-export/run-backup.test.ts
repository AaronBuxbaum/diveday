import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { shopBackupDeliveries } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import { listBackupDeliveries } from "./delivery-store";
import {
  disconnectShopBackupDestination,
  getShopBackupDestination,
  saveShopBackupDestination,
} from "./destination-store";
import { runShopBackup } from "./run-backup";

const KEY = randomBytes(32);
const NOW = new Date("2026-08-04T06:00:00Z");

const DESTINATION = {
  endpoint: "https://backups.example.com",
  region: "auto",
  bucket: "shop-backups",
  prefix: "diveday",
  accessKeyId: "AKIA-TEST-KEY-ID",
  secretAccessKey: "very-secret-access-key",
};

const LABELS = {
  calendarName: "label-calendar-name",
  crew: "label-crew",
  course: "label-course",
  day: (n: number) => `label-day-${n}`,
};

/**
 * The seeded shop with this test's own destination and a blank delivery
 * history — the seed ships blue-mantis with both (src/db/seed-backup.ts), and
 * the seeded "yesterday" delivery lands in whatever ISO week the suite runs
 * in, which is exactly the week these idempotency tests reason about.
 */
async function backupContext() {
  const { db, shop } = await seededShopContext();
  await disconnectShopBackupDestination(db, shop.id);
  await db.delete(shopBackupDeliveries).where(eq(shopBackupDeliveries.shopId, shop.id));
  const saved = await saveShopBackupDestination(
    db,
    { shopId: shop.id, ...DESTINATION },
    { key: KEY },
  );
  if (saved.status !== "saved") throw new Error("destination save failed");
  return { db, shop };
}

function capturingFetch(status = 200) {
  const calls: { url: string; body: Uint8Array }[] = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    trigger: "manual" as const,
    icsLabels: LABELS,
    origin: "https://app.example.com",
    now: NOW,
    key: KEY,
    ...overrides,
  };
}

describe("runShopBackup", () => {
  it("uploads the export bundle with trips.ics riding along and records a succeeded delivery", async () => {
    const { db, shop } = await backupContext();
    const { fetchImpl, calls } = capturingFetch();

    const result = await runShopBackup(db, { ...runInput({ fetchImpl }), shopId: shop.id });
    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") throw new Error("unreachable");
    expect(result.objectKey).toBe("diveday/diveday-backup-blue-mantis-2026-W32.zip");
    expect(result.byteCount).toBeGreaterThan(0);

    // One PUT, to the destination's path-style URL for that key.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://backups.example.com/shop-backups/diveday/diveday-backup-blue-mantis-2026-W32.zip",
    );

    // The uploaded bytes are the real bundle: README plus CSVs plus the feed.
    const entries = unzipSync(calls[0]?.body ?? new Uint8Array());
    const names = Object.keys(entries);
    expect(names).toContain("README.txt");
    expect(names).toContain("people.csv");
    expect(names).toContain("waiver_records.csv");
    expect(names).toContain("trips.ics");
    const ics = new TextDecoder().decode(entries["trips.ics"]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("label-calendar-name");
    // calendar-sync's invariant, re-asserted at the bundle boundary: the feed
    // carries departures and crew, never a diver holding a booking.
    expect(ics).not.toContain("bookings");

    const page = await listBackupDeliveries(db, shop.id, { pageSize: 5 });
    expect(page.rows[0]).toMatchObject({
      status: "succeeded",
      trigger: "manual",
      periodKey: "2026-W32",
      objectKey: "diveday/diveday-backup-blue-mantis-2026-W32.zip",
      byteCount: result.byteCount,
    });
    expect((await getShopBackupDestination(db, shop.id))?.verifiedAt).not.toBeNull();
  });

  it("records a failed row with a code when the bucket refuses the credential, and does not throw", async () => {
    const { db, shop } = await backupContext();
    const { fetchImpl } = capturingFetch(403);

    const result = await runShopBackup(db, { ...runInput({ fetchImpl }), shopId: shop.id });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.errorCode).toBe("upload_unauthorized");

    const page = await listBackupDeliveries(db, shop.id, { pageSize: 5 });
    expect(page.rows[0]).toMatchObject({ status: "failed", errorCode: "upload_unauthorized" });
    expect((await getShopBackupDestination(db, shop.id))?.verifiedAt).toBeNull();
  });

  it("records credential_unreadable when the stored secret cannot be opened", async () => {
    const { db, shop } = await backupContext();
    const { fetchImpl, calls } = capturingFetch();

    const result = await runShopBackup(db, {
      ...runInput({ fetchImpl, key: randomBytes(32) }),
      shopId: shop.id,
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "credential_unreadable" });
    // Nothing was ever sent — the failure happened before any bytes left.
    expect(calls).toHaveLength(0);

    const page = await listBackupDeliveries(db, shop.id, { pageSize: 5 });
    expect(page.rows[0]).toMatchObject({ status: "failed", errorCode: "credential_unreadable" });
  });

  it("records the key-configuration refusal so staff can see why nothing is landing", async () => {
    const { db, shop } = await backupContext();
    const result = await runShopBackup(db, { ...runInput({ key: null }), shopId: shop.id });
    expect(result).toMatchObject({ status: "failed", errorCode: "credential_unreadable" });
  });

  it("answers no_destination without writing any delivery row", async () => {
    const { db, shop } = await seededShopContext();
    await disconnectShopBackupDestination(db, shop.id);
    const before = (await listBackupDeliveries(db, shop.id, { pageSize: 50 })).total;

    const result = await runShopBackup(db, { ...runInput(), shopId: shop.id });
    expect(result).toEqual({ status: "no_destination" });
    expect((await listBackupDeliveries(db, shop.id, { pageSize: 50 })).total).toBe(before);
  });

  it("skips a second scheduled run in the same week, but lets a manual run proceed", async () => {
    const { db, shop } = await backupContext();
    const { fetchImpl } = capturingFetch();

    const first = await runShopBackup(db, {
      ...runInput({ fetchImpl, trigger: "scheduled" }),
      shopId: shop.id,
    });
    expect(first.status).toBe("delivered");

    const second = await runShopBackup(db, {
      ...runInput({ fetchImpl, trigger: "scheduled" }),
      shopId: shop.id,
    });
    expect(second).toEqual({ status: "skipped_already_delivered", periodKey: "2026-W32" });

    const manual = await runShopBackup(db, { ...runInput({ fetchImpl }), shopId: shop.id });
    expect(manual.status).toBe("delivered");

    // Two delivered rows, one skip that wrote nothing.
    const page = await listBackupDeliveries(db, shop.id, { pageSize: 50 });
    const thisWeeks = page.rows.filter((row) => row.periodKey === "2026-W32");
    expect(thisWeeks).toHaveLength(2);
  });

  it("retries the week after a failed scheduled run instead of treating failure as done", async () => {
    const { db, shop } = await backupContext();
    const failing = capturingFetch(500);
    const first = await runShopBackup(db, {
      ...runInput({ fetchImpl: failing.fetchImpl, trigger: "scheduled" }),
      shopId: shop.id,
    });
    expect(first).toMatchObject({ status: "failed", errorCode: "upload_rejected" });

    const working = capturingFetch();
    const second = await runShopBackup(db, {
      ...runInput({ fetchImpl: working.fetchImpl, trigger: "scheduled" }),
      shopId: shop.id,
    });
    expect(second.status).toBe("delivered");
    // The retry overwrote the same deterministic object key.
    expect(working.calls[0]?.url).toContain("diveday-backup-blue-mantis-2026-W32.zip");
  });

  it("never lets the plaintext secret reach the URL or the delivery row", async () => {
    const { db, shop } = await backupContext();
    const { fetchImpl, calls } = capturingFetch();
    await runShopBackup(db, { ...runInput({ fetchImpl }), shopId: shop.id });

    expect(calls[0]?.url).not.toContain(DESTINATION.secretAccessKey);
    const page = await listBackupDeliveries(db, shop.id, { pageSize: 5 });
    expect(JSON.stringify(page.rows)).not.toContain(DESTINATION.secretAccessKey);
  });
});
