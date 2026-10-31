import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AppDb } from "./client";
import { shopBackupDeliveryClaims } from "./schema";

/** Insert a single claim keyed by its shop and period, returning the prune arm's composite identity. */
export async function writeBackupDeliveryClaimFixture(
  db: AppDb,
  shopId: string,
  completedAt: Date,
  n: 0 | 1,
): Promise<string> {
  const [row] = await db
    .insert(shopBackupDeliveryClaims)
    .values({
      shopId,
      periodKey: `retention-fixture-${n}-${randomUUID()}`,
      attemptNumber: 1,
      completedAt,
    })
    .returning({
      id: sql<string>`${shopBackupDeliveryClaims.shopId}::text || ':' || ${shopBackupDeliveryClaims.periodKey}`,
    });
  if (!row) throw new Error("backup claim fixture insert returned nothing");
  return row.id;
}
