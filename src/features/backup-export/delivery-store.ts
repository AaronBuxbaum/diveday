import { and, count, desc, eq, notExists } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { type OffsetPage, offsetPage } from "@/db/paging";
import type { BackupDeliveryTrigger, ShopBackupDelivery, ShopBackupDestination } from "@/db/schema";
import { shopBackupDeliveries, shopBackupDestinations, shops } from "@/db/schema";
import { nowDate } from "@/lib/clock";

/**
 * The delivery ledger: one row per backup attempt, inserted as `started` and
 * finished in place — so a crash mid-upload leaves an honest `started` row
 * rather than silence, and "when did my data last land in my bucket" is a
 * query, not a guess. Error codes only, never sentences (ADR
 * 20260731-domain-layer-copy-leaks).
 */

export async function beginBackupDelivery(
  db: DbExecutor,
  input: {
    shopId: string;
    periodKey: string;
    trigger: BackupDeliveryTrigger;
    now?: Date;
  },
): Promise<ShopBackupDelivery> {
  const [row] = await db
    .insert(shopBackupDeliveries)
    .values({
      shopId: input.shopId,
      periodKey: input.periodKey,
      trigger: input.trigger,
      status: "started",
      startedAt: input.now ?? nowDate(),
    })
    .returning();
  if (!row) throw new Error("backup delivery insert returned no row");
  return row;
}

export async function finishBackupDelivery(
  db: DbExecutor,
  input:
    | { id: string; status: "succeeded"; objectKey: string; byteCount: number; now?: Date }
    | { id: string; status: "failed"; errorCode: string; now?: Date },
): Promise<void> {
  await db
    .update(shopBackupDeliveries)
    .set(
      input.status === "succeeded"
        ? {
            status: "succeeded",
            objectKey: input.objectKey,
            byteCount: input.byteCount,
            errorCode: null,
            finishedAt: input.now ?? nowDate(),
          }
        : {
            status: "failed",
            errorCode: input.errorCode,
            finishedAt: input.now ?? nowDate(),
          },
    )
    .where(eq(shopBackupDeliveries.id, input.id));
}

/**
 * Whether this period's scheduled backup already landed — the idempotency
 * check that makes a re-invoked weekly cron a no-op. Manual runs are not
 * counted: a staff test run mid-week must not cancel the scheduled delivery,
 * whose object key and cadence are what the shop's retention tooling watches.
 */
export async function hasDeliveredScheduledBackup(
  db: DbExecutor,
  shopId: string,
  periodKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shopBackupDeliveries.id })
    .from(shopBackupDeliveries)
    .where(
      and(
        eq(shopBackupDeliveries.shopId, shopId),
        eq(shopBackupDeliveries.periodKey, periodKey),
        eq(shopBackupDeliveries.trigger, "scheduled"),
        eq(shopBackupDeliveries.status, "succeeded"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** One page of a shop's delivery history, newest first (`src/components/Pager.tsx` wears it). */
export async function listBackupDeliveries(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; pageSize: number },
): Promise<OffsetPage<ShopBackupDelivery>> {
  return offsetPage({
    page: options.page,
    pageSize: options.pageSize,
    countRows: async () => {
      const [row] = await db
        .select({ n: count() })
        .from(shopBackupDeliveries)
        .where(eq(shopBackupDeliveries.shopId, shopId));
      return row?.n ?? 0;
    },
    fetchRows: (offset, limit) =>
      db
        .select()
        .from(shopBackupDeliveries)
        .where(eq(shopBackupDeliveries.shopId, shopId))
        .orderBy(desc(shopBackupDeliveries.startedAt), desc(shopBackupDeliveries.id))
        .offset(offset)
        .limit(limit),
  });
}

export type BackupDueShop = {
  destination: ShopBackupDestination;
  shopSlug: string;
  shopName: string;
  shopLocale: string | null;
};

/**
 * Every shop the weekly pass still owes for this period: has a destination,
 * and no succeeded scheduled delivery yet. A shop whose last attempt *failed*
 * is due again — the weekly cadence is the retry policy, so a broken bucket
 * costs one recorded failure per week, never a storm.
 */
export async function listShopsDueForBackup(
  db: DbExecutor,
  periodKey: string,
): Promise<BackupDueShop[]> {
  const rows = await db
    .select({
      destination: shopBackupDestinations,
      shopSlug: shops.slug,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
    })
    .from(shopBackupDestinations)
    .innerJoin(shops, eq(shops.id, shopBackupDestinations.shopId))
    .where(
      notExists(
        db
          .select({ id: shopBackupDeliveries.id })
          .from(shopBackupDeliveries)
          .where(
            and(
              eq(shopBackupDeliveries.shopId, shopBackupDestinations.shopId),
              eq(shopBackupDeliveries.periodKey, periodKey),
              eq(shopBackupDeliveries.trigger, "scheduled"),
              eq(shopBackupDeliveries.status, "succeeded"),
            ),
          ),
      ),
    )
    .orderBy(shopBackupDestinations.connectedAt, shopBackupDestinations.shopId);
  return rows;
}
