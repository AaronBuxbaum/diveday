import { nowMs } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { shopBackupDeliveries, shopBackupDestinations } from "./schema";
import { at, DAY_MS } from "./seed-clock";

/**
 * The demo shop's backup story (ADR 20260804-shop-owned-backup-export): a
 * destination that has been quietly delivering for a month and a half, with
 * one bad week in the middle — because the surface exists to answer "did my
 * data land", and a history that is all green teaches less than one that
 * shows what a failure looks like.
 *
 * The sealed-secret column holds a placeholder that no key can open, on
 * purpose: the demo bucket does not exist, dev environments rarely configure
 * `SECRET_ENCRYPTION_KEY`, and a seeded credential that *could* open would be
 * a fake secret pretending to be a real one. A test run against this seeded
 * row honestly reports its credential as unreadable; the e2e flow saves its
 * own destination (sealed with the fleet's key) before exercising a run.
 */
export async function seedBackup(db: DbExecutor, shopId: string): Promise<void> {
  await db.insert(shopBackupDestinations).values({
    shopId,
    endpoint: "https://backups.blue-mantis.example",
    region: "auto",
    bucket: "blue-mantis-backups",
    prefix: "diveday",
    accessKeyId: "BMKEYIDDEMO0001",
    secretAccessKeySealed: "v1.demo.demo.demo",
    connectedAt: at(-45, 9),
    verifiedAt: at(-1, 4),
    updatedAt: at(-45, 9),
  });

  /** The ISO week key for an instant, matching src/features/backup-export/period.ts. */
  const periodKey = (instant: Date): string => {
    const date = new Date(
      Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
    );
    const isoDay = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - isoDay);
    const isoYear = date.getUTCFullYear();
    const week = Math.ceil(((date.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  };

  // Six weekly runs, newest one yesterday. Week -3 failed — the bucket
  // refused the key that week — and the next run went back to green, which is
  // exactly the retry story the settings page documents.
  const weeks = [-36, -29, -22, -15, -8, -1];
  const bundleBytes = [48_113_204, 48_552_910, 49_120_338, 49_887_002, 50_412_775, 51_034_561];
  const rows: (typeof shopBackupDeliveries.$inferInsert)[] = weeks.map((daysAgo, index) => {
    const startedAt = at(daysAgo, 4);
    const failed = index === 2;
    return {
      shopId,
      periodKey: periodKey(startedAt),
      trigger: "scheduled",
      status: failed ? "failed" : "succeeded",
      objectKey: failed ? null : `diveday/diveday-backup-blue-mantis-${periodKey(startedAt)}.zip`,
      byteCount: failed ? null : bundleBytes[index],
      errorCode: failed ? "upload_unauthorized" : null,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + (failed ? 21_000 : 74_000)),
    };
  });

  // Plus the manual proof run staff did right after connecting.
  const firstTest = new Date(nowMs() - 45 * DAY_MS + 30 * 60 * 1000);
  rows.unshift({
    shopId,
    periodKey: periodKey(firstTest),
    trigger: "manual",
    status: "succeeded",
    objectKey: `diveday/diveday-backup-blue-mantis-${periodKey(firstTest)}.zip`,
    byteCount: 44_902_113,
    errorCode: null,
    startedAt: firstTest,
    finishedAt: new Date(firstTest.getTime() + 68_000),
  });

  await db.insert(shopBackupDeliveries).values(rows);
}
