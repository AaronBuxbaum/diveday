import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { boats, shopBackupDeliveries, shopBackupDestinations, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { FactRefused } from "./refusal";

/**
 * **A boat with a photo** (`boatPhoto`): the private shop's Mantis I takes one
 * of the bundled dive-site images, and the answer names the boat and its first
 * departure so the capture can open both. A private shop's fact: a photo is
 * shop-wide settings.
 */
export async function giveTheFirstBoatAPhoto(db: AppDb, shop: { id: string }) {
  const [boat] = await db
    .select({ id: boats.id, name: boats.name })
    .from(boats)
    .where(and(eq(boats.shopId, shop.id), eq(boats.name, "Mantis I"), isNull(boats.deletedAt)))
    .limit(1);
  if (!boat) throw new FactRefused("not_available", 404);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.boatId, boat.id), liveTrip()))
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!trip) throw new FactRefused("not_available", 404);
  await db
    .update(boats)
    .set({ photoUrl: "/dive-sites/Crash Boat 01.jpg" })
    .where(and(eq(boats.shopId, shop.id), eq(boats.id, boat.id)));
  return { boat, trip };
}

/**
 * **A backup that failed after one that worked** (`backupFailed`): a verified
 * destination with a placeholder secret no provider can read, a success a day
 * ago and a network failure an hour ago. Nothing calls a provider.
 */
export async function failTheLatestBackup(db: AppDb, shop: { id: string }, now: Date) {
  const succeededAt = new Date(now.getTime() - DAY_MS);
  await db
    .insert(shopBackupDestinations)
    .values({
      shopId: shop.id,
      endpoint: "https://backup-visual.example",
      region: "auto",
      bucket: "visual-backups",
      prefix: "diveday",
      accessKeyId: "VISUAL-EXAMPLE-ONLY",
      // An intentionally unreadable placeholder: no provider call or real credential.
      secretAccessKeySealed: "v1.visual.visual.visual",
      verifiedAt: succeededAt,
    })
    .onConflictDoUpdate({
      target: shopBackupDestinations.shopId,
      set: { verifiedAt: succeededAt },
    });
  await db.insert(shopBackupDeliveries).values([
    {
      shopId: shop.id,
      periodKey: "visual-success",
      trigger: "manual",
      status: "succeeded",
      objectKey: "visual/previous-success.zip",
      byteCount: 32000,
      startedAt: succeededAt,
      finishedAt: succeededAt,
    },
    {
      shopId: shop.id,
      periodKey: "visual-failure",
      trigger: "manual",
      status: "failed",
      errorCode: "network_unreachable",
      startedAt: new Date(now.getTime() - HOUR_MS),
      finishedAt: new Date(now.getTime() - HOUR_MS),
    },
  ]);
}
