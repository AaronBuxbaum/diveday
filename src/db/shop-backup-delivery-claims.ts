import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { boundLockWaits, isLockWaitRefusal } from "./lock-bounds";
import { shopBackupDeliveries, shopBackupDeliveryClaims } from "./schema";

/** A shop cron pass is bounded to five minutes; ten minutes leaves room for a slow upload. */
export const SHOP_BACKUP_DELIVERY_LEASE_MS = 10 * 60_000;

export type ShopBackupDeliveryClaim =
  | { status: "claimed"; attemptNumber: number }
  | { status: "already_delivered" }
  | { status: "in_progress" };

/** Claim one shop/week before building its bundle or contacting its bucket. */
export async function claimShopBackupDelivery(
  db: AppDb,
  input: { shopId: string; periodKey: string; token: string; now: Date },
): Promise<ShopBackupDeliveryClaim> {
  const leaseUntil = new Date(input.now.getTime() + SHOP_BACKUP_DELIVERY_LEASE_MS);
  try {
    return await db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const [delivered] = await tx
        .select({ id: shopBackupDeliveries.id })
        .from(shopBackupDeliveries)
        .where(
          and(
            eq(shopBackupDeliveries.shopId, input.shopId),
            eq(shopBackupDeliveries.periodKey, input.periodKey),
            eq(shopBackupDeliveries.trigger, "scheduled"),
            eq(shopBackupDeliveries.status, "succeeded"),
          ),
        )
        .limit(1);
      if (delivered) return { status: "already_delivered" };

      const [claim] = await tx
        .insert(shopBackupDeliveryClaims)
        .values({
          shopId: input.shopId,
          periodKey: input.periodKey,
          attemptNumber: 1,
          leaseToken: input.token,
          leaseUntil,
        })
        .onConflictDoUpdate({
          target: [shopBackupDeliveryClaims.shopId, shopBackupDeliveryClaims.periodKey],
          set: {
            attemptNumber: sql`${shopBackupDeliveryClaims.attemptNumber} + 1`,
            leaseToken: input.token,
            leaseUntil,
          },
          where: and(
            isNull(shopBackupDeliveryClaims.completedAt),
            or(
              isNull(shopBackupDeliveryClaims.leaseUntil),
              lte(shopBackupDeliveryClaims.leaseUntil, input.now),
            ),
          ),
        })
        .returning({ attemptNumber: shopBackupDeliveryClaims.attemptNumber });
      if (claim) return { status: "claimed", attemptNumber: claim.attemptNumber };

      const [latest] = await tx
        .select({ completedAt: shopBackupDeliveryClaims.completedAt })
        .from(shopBackupDeliveryClaims)
        .where(
          and(
            eq(shopBackupDeliveryClaims.shopId, input.shopId),
            eq(shopBackupDeliveryClaims.periodKey, input.periodKey),
          ),
        )
        .limit(1);
      return latest?.completedAt ? { status: "already_delivered" } : { status: "in_progress" };
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) return { status: "in_progress" };
    throw error;
  }
}

/** Extend the same worker's lease before its potentially slow external upload. */
export async function renewShopBackupDeliveryClaim(
  db: AppDb,
  input: { shopId: string; periodKey: string; token: string; now: Date },
): Promise<boolean> {
  const [renewed] = await db
    .update(shopBackupDeliveryClaims)
    .set({ leaseUntil: new Date(input.now.getTime() + SHOP_BACKUP_DELIVERY_LEASE_MS) })
    .where(
      and(
        eq(shopBackupDeliveryClaims.shopId, input.shopId),
        eq(shopBackupDeliveryClaims.periodKey, input.periodKey),
        eq(shopBackupDeliveryClaims.leaseToken, input.token),
        isNull(shopBackupDeliveryClaims.completedAt),
      ),
    )
    .returning({ shopId: shopBackupDeliveryClaims.shopId });
  return Boolean(renewed);
}

/**
 * Finish a scheduled upload only while its fencing token still owns the week.
 * Attempt-specific object keys ensure an expired worker cannot overwrite a
 * newer run even if its already-sent S3 request finishes late.
 */
export async function finishShopBackupDelivery(
  db: AppDb,
  input: {
    shopId: string;
    periodKey: string;
    token: string;
    deliveryId: string;
    objectKey: string;
    byteCount: number;
    now: Date;
  },
): Promise<"succeeded" | "superseded"> {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const [claim] = await tx
      .update(shopBackupDeliveryClaims)
      .set({ completedAt: input.now, leaseToken: null, leaseUntil: null })
      .where(
        and(
          eq(shopBackupDeliveryClaims.shopId, input.shopId),
          eq(shopBackupDeliveryClaims.periodKey, input.periodKey),
          eq(shopBackupDeliveryClaims.leaseToken, input.token),
          isNull(shopBackupDeliveryClaims.completedAt),
        ),
      )
      .returning({ shopId: shopBackupDeliveryClaims.shopId });

    if (!claim) {
      await tx
        .update(shopBackupDeliveries)
        .set({
          status: "superseded",
          objectKey: input.objectKey,
          byteCount: input.byteCount,
          errorCode: null,
          finishedAt: input.now,
        })
        .where(
          and(
            eq(shopBackupDeliveries.id, input.deliveryId),
            eq(shopBackupDeliveries.shopId, input.shopId),
            eq(shopBackupDeliveries.periodKey, input.periodKey),
            eq(shopBackupDeliveries.trigger, "scheduled"),
            eq(shopBackupDeliveries.status, "started"),
          ),
        );
      return "superseded";
    }

    const [delivery] = await tx
      .update(shopBackupDeliveries)
      .set({
        status: "succeeded",
        objectKey: input.objectKey,
        byteCount: input.byteCount,
        errorCode: null,
        finishedAt: input.now,
      })
      .where(
        and(
          eq(shopBackupDeliveries.id, input.deliveryId),
          eq(shopBackupDeliveries.shopId, input.shopId),
          eq(shopBackupDeliveries.periodKey, input.periodKey),
          eq(shopBackupDeliveries.trigger, "scheduled"),
          eq(shopBackupDeliveries.status, "started"),
        ),
      )
      .returning({ id: shopBackupDeliveries.id });
    if (!delivery) throw new Error("scheduled backup delivery could not be finalized");
    return "succeeded";
  });
}

/** Record that this worker lost its claim before it sent an object. */
export async function supersedeShopBackupDelivery(
  db: AppDb,
  input: { shopId: string; periodKey: string; deliveryId: string; now: Date },
): Promise<void> {
  await db
    .update(shopBackupDeliveries)
    .set({ status: "superseded", errorCode: null, finishedAt: input.now })
    .where(
      and(
        eq(shopBackupDeliveries.id, input.deliveryId),
        eq(shopBackupDeliveries.shopId, input.shopId),
        eq(shopBackupDeliveries.periodKey, input.periodKey),
        eq(shopBackupDeliveries.trigger, "scheduled"),
        eq(shopBackupDeliveries.status, "started"),
      ),
    );
}
