import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import type { HeldSendKind, HeldSendPayload } from "@/lib/held-sends";
import { notificationSendQueue } from "./schema";

/**
 * The two spellings every held-send writer and reader shares (issue #2730):
 * what a held row of the send queue is, and what one is written as. A module
 * of its own because the writers (`trip-rescheduled`, `counter-payment-hold`,
 * `departure-notes`) are also what `held-sends` executes, and importing it
 * would close a cycle.
 */

/** A held row of this shop still inside its hold: queued, not yet claimed, of this kind. */
export function heldQueuedOfKind(shopId: string, kind: HeldSendKind): SQL {
  return and(
    eq(notificationSendQueue.shopId, shopId),
    isNotNull(notificationSendQueue.intent),
    eq(notificationSendQueue.status, "queued"),
    sql`${notificationSendQueue.intent}->>'kind' = ${kind}`,
  ) as SQL;
}

/** The values a held row is inserted with: its own id, an idempotency key from it, and the hold. */
export function heldSendValues(input: {
  shopId: string;
  payload: HeldSendPayload;
  actorPersonId: string | null;
  runAt: Date;
}): typeof notificationSendQueue.$inferInsert {
  const id = crypto.randomUUID();
  return {
    id,
    shopId: input.shopId,
    idempotencyKey: `held-send/${id}`,
    intent: input.payload,
    actorPersonId: input.actorPersonId,
    status: "queued",
    nextAttemptAt: input.runAt,
  };
}
