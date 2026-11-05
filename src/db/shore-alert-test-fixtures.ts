import type { DbExecutor } from "./client";
import { capabilities, shopShoreAlertTokens } from "./schema";

/**
 * One `shop_shore_alert_tokens` row (H-20261014-stale-roll-call-recipients) for the guards that seed every
 * table: a confirm link, at the given creation time and expiring a day later.
 */
export async function insertShoreAlertToken(
  db: DbExecutor,
  input: { shopId: string; tokenHash: string; createdAt: Date },
): Promise<string> {
  const [row] = await db
    .insert(shopShoreAlertTokens)
    .values({
      ...input,
      purpose: "confirm",
      email: "shore@example.com",
      expiresAt: new Date(input.createdAt.getTime() + 24 * 60 * 60 * 1000),
    })
    .returning({ id: shopShoreAlertTokens.id });
  if (!row) throw new Error("fixture insert returned nothing");
  return row.id;
}

/**
 * One `shore_alert_stop` capability (issue #3721) for the retention guard: the
 * stop link a roll-call alert carries, at the given issue time.
 */
export async function insertShoreAlertStop(
  db: DbExecutor,
  input: { shopId: string; tokenHash: string; issuedAt: Date },
): Promise<string> {
  const [row] = await db
    .insert(capabilities)
    .values({ ...input, purpose: "shore_alert_stop", sentTo: "shore@example.com" })
    .returning({ id: capabilities.id });
  if (!row) throw new Error("fixture insert returned nothing");
  return row.id;
}
