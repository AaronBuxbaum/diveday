import type { DbExecutor } from "./client";
import { shopShoreAlertTokens } from "./schema";

/**
 * One `shop_shore_alert_tokens` row (H-20261014-stale-roll-call-recipients) for the guards that seed every
 * table: a stop link, the kind with no expiry, at the given creation time.
 */
export async function insertShoreAlertToken(
  db: DbExecutor,
  input: { shopId: string; tokenHash: string; createdAt: Date },
): Promise<string> {
  const [row] = await db
    .insert(shopShoreAlertTokens)
    .values({ ...input, purpose: "stop", email: "shore@example.com" })
    .returning({ id: shopShoreAlertTokens.id });
  if (!row) throw new Error("fixture insert returned nothing");
  return row.id;
}
