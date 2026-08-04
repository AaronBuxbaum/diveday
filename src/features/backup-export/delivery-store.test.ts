import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shops } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  beginBackupDelivery,
  finishBackupDelivery,
  hasDeliveredScheduledBackup,
  listBackupDeliveries,
  listShopsDueForBackup,
} from "./delivery-store";
import { saveShopBackupDestination } from "./destination-store";

const KEY = randomBytes(32);
const PERIOD = "2099-W07";

const DESTINATION = {
  endpoint: "https://backups.example.com",
  region: "auto",
  bucket: "shop-backups",
  prefix: "",
  accessKeyId: "AKIA-TEST-KEY-ID",
  secretAccessKey: "very-secret-access-key",
};

async function bareShop(suffix: string) {
  const { db } = await seededShopContext();
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${suffix}`, slug: `delivery-test-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return { db, shop };
}

describe("delivery lifecycle", () => {
  it("begins as started and finishes as succeeded with the object's facts", async () => {
    const { db, shop } = await bareShop("lifecycle");
    const row = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "scheduled",
    });
    expect(row.status).toBe("started");
    expect(row.finishedAt).toBeNull();

    await finishBackupDelivery(db, {
      id: row.id,
      status: "succeeded",
      objectKey: "diveday-backup-x.zip",
      byteCount: 12_345,
    });
    const page = await listBackupDeliveries(db, shop.id, { pageSize: 10 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      status: "succeeded",
      objectKey: "diveday-backup-x.zip",
      byteCount: 12_345,
      errorCode: null,
    });
    expect(page.rows[0]?.finishedAt).not.toBeNull();
  });

  it("records a failure as a code, never a sentence", async () => {
    const { db, shop } = await bareShop("failure");
    const row = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "manual",
    });
    await finishBackupDelivery(db, { id: row.id, status: "failed", errorCode: "bucket_not_found" });

    const page = await listBackupDeliveries(db, shop.id, { pageSize: 10 });
    expect(page.rows[0]).toMatchObject({ status: "failed", errorCode: "bucket_not_found" });
  });
});

describe("hasDeliveredScheduledBackup", () => {
  it("counts only a succeeded scheduled delivery for that period", async () => {
    const { db, shop } = await bareShop("idempotency");

    expect(await hasDeliveredScheduledBackup(db, shop.id, PERIOD)).toBe(false);

    // A failed scheduled attempt does not satisfy the week.
    const failed = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "scheduled",
    });
    await finishBackupDelivery(db, {
      id: failed.id,
      status: "failed",
      errorCode: "network_unreachable",
    });
    expect(await hasDeliveredScheduledBackup(db, shop.id, PERIOD)).toBe(false);

    // A *manual* success mid-week does not either — the scheduled cadence still owes its run.
    const manual = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "manual",
    });
    await finishBackupDelivery(db, {
      id: manual.id,
      status: "succeeded",
      objectKey: "k.zip",
      byteCount: 1,
    });
    expect(await hasDeliveredScheduledBackup(db, shop.id, PERIOD)).toBe(false);

    const scheduled = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "scheduled",
    });
    await finishBackupDelivery(db, {
      id: scheduled.id,
      status: "succeeded",
      objectKey: "k.zip",
      byteCount: 1,
    });
    expect(await hasDeliveredScheduledBackup(db, shop.id, PERIOD)).toBe(true);
    // Another period still owes.
    expect(await hasDeliveredScheduledBackup(db, shop.id, "2099-W08")).toBe(false);
  });
});

describe("listBackupDeliveries", () => {
  it("pages newest first with the shared offset shape", async () => {
    const { db, shop } = await bareShop("paging");
    for (let week = 1; week <= 7; week += 1) {
      const row = await beginBackupDelivery(db, {
        shopId: shop.id,
        periodKey: `2099-W${String(week).padStart(2, "0")}`,
        trigger: "scheduled",
        now: new Date(Date.UTC(2099, 0, week)),
      });
      await finishBackupDelivery(db, {
        id: row.id,
        status: "succeeded",
        objectKey: `k-${week}.zip`,
        byteCount: week,
      });
    }

    const first = await listBackupDeliveries(db, shop.id, { page: 1, pageSize: 3 });
    expect(first.total).toBe(7);
    expect(first.pageCount).toBe(3);
    expect(first.rows.map((row) => row.periodKey)).toEqual(["2099-W07", "2099-W06", "2099-W05"]);

    const last = await listBackupDeliveries(db, shop.id, { page: 3, pageSize: 3 });
    expect(last.rows.map((row) => row.periodKey)).toEqual(["2099-W01"]);
  });

  it("never shows another shop's deliveries", async () => {
    const { db, shop } = await bareShop("tenant-a");
    const [other] = await db
      .insert(shops)
      .values({ name: "Tenant B", slug: "delivery-test-tenant-b", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    await beginBackupDelivery(db, { shopId: other.id, periodKey: PERIOD, trigger: "scheduled" });

    const page = await listBackupDeliveries(db, shop.id, { pageSize: 10 });
    expect(page.rows.every((row) => row.shopId === shop.id)).toBe(true);
    expect(page.rows.find((row) => row.shopId === other.id)).toBeUndefined();
  });
});

describe("listShopsDueForBackup", () => {
  it("lists a destination-holding shop until its scheduled delivery succeeds", async () => {
    const { db, shop } = await bareShop("due");
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });

    const dueBefore = await listShopsDueForBackup(db, PERIOD);
    expect(dueBefore.map((entry) => entry.destination.shopId)).toContain(shop.id);
    const entry = dueBefore.find((candidate) => candidate.destination.shopId === shop.id);
    expect(entry?.shopSlug).toBe("delivery-test-due");

    const row = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "scheduled",
    });
    await finishBackupDelivery(db, {
      id: row.id,
      status: "succeeded",
      objectKey: "k.zip",
      byteCount: 1,
    });

    const dueAfter = await listShopsDueForBackup(db, PERIOD);
    expect(dueAfter.map((candidate) => candidate.destination.shopId)).not.toContain(shop.id);
  });

  it("keeps a shop whose last attempt failed on the due list — the next week is the retry", async () => {
    const { db, shop } = await bareShop("due-failed");
    await saveShopBackupDestination(db, { shopId: shop.id, ...DESTINATION }, { key: KEY });
    const row = await beginBackupDelivery(db, {
      shopId: shop.id,
      periodKey: PERIOD,
      trigger: "scheduled",
    });
    await finishBackupDelivery(db, {
      id: row.id,
      status: "failed",
      errorCode: "upload_unauthorized",
    });

    const due = await listShopsDueForBackup(db, PERIOD);
    expect(due.map((candidate) => candidate.destination.shopId)).toContain(shop.id);
  });

  it("never lists a shop with no destination", async () => {
    const { db, shop } = await bareShop("due-none");
    const due = await listShopsDueForBackup(db, PERIOD);
    expect(due.map((candidate) => candidate.destination.shopId)).not.toContain(shop.id);
  });
});
