import type { DbExecutor } from "../../../db/client";
import { capabilities } from "../../../db/schema/index";

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
