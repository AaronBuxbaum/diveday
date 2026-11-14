import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { people, unresolvedSafetyAlertDeliveries, unresolvedSafetyAlertOutbox } from "@/db/schema";
import { nowDate } from "@/lib/clock";

/** Internal delivery bookkeeping. This does not authorize a recipient, check
 * the evidence, build a URL or send a message; the disabled dispatcher must
 * do those separately before this can be used. */
export async function ensureSafetyReviewDelivery(
  db: DbExecutor,
  input: { outboxId: string; personId: string },
) {
  // The outbox and recipient must belong to the same shop. Insert with the
  // check in one statement so a foreign person cannot reserve this key.
  await db.execute(sql`
    insert into ${unresolvedSafetyAlertDeliveries} (outbox_id, person_id, created_at)
    select ${unresolvedSafetyAlertOutbox.id}, ${people.id}, ${nowDate()}
    from ${unresolvedSafetyAlertOutbox}
    inner join ${people} on ${people.shopId} = ${unresolvedSafetyAlertOutbox.shopId}
    where ${unresolvedSafetyAlertOutbox.id} = ${input.outboxId}
      and ${people.id} = ${input.personId}
    on conflict (outbox_id, person_id) do nothing
  `);
  const [delivery] = await db
    .select({ id: unresolvedSafetyAlertDeliveries.id })
    .from(unresolvedSafetyAlertDeliveries)
    .innerJoin(
      unresolvedSafetyAlertOutbox,
      eq(unresolvedSafetyAlertOutbox.id, unresolvedSafetyAlertDeliveries.outboxId),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, unresolvedSafetyAlertDeliveries.personId),
        eq(people.shopId, unresolvedSafetyAlertOutbox.shopId),
      ),
    )
    .where(
      and(
        eq(unresolvedSafetyAlertDeliveries.outboxId, input.outboxId),
        eq(unresolvedSafetyAlertDeliveries.personId, input.personId),
      ),
    )
    .limit(1);
  if (!delivery) throw new Error("Safety review delivery could not be recorded");
  return delivery.id;
}

/** Exactly one worker can take a pending row; an attempt ID fences late results. */
export async function startSafetyReviewDelivery(db: DbExecutor, deliveryId: string) {
  const attemptId = crypto.randomUUID();
  const [row] = await db
    .update(unresolvedSafetyAlertDeliveries)
    .set({ status: "sending", attemptId, attemptedAt: nowDate() })
    .where(
      and(
        eq(unresolvedSafetyAlertDeliveries.id, deliveryId),
        eq(unresolvedSafetyAlertDeliveries.status, "pending"),
      ),
    )
    .returning({ id: unresolvedSafetyAlertDeliveries.id });
  return row ? attemptId : null;
}

/** `not_configured` and `not_attempted` mean the provider was never contacted and can be retried.
 * Any ambiguous provider outcome must be `uncertain`, not an automatic retry. */
export async function finishSafetyReviewDelivery(
  db: DbExecutor,
  input: { deliveryId: string; attemptId: string } & (
    | { outcome: "not_configured" | "not_attempted" }
    | { outcome: "uncertain" }
    | { outcome: "delivered"; providerMessageId: string }
  ),
) {
  const update =
    input.outcome === "not_configured" || input.outcome === "not_attempted"
      ? { status: "pending", attemptId: null, attemptedAt: null }
      : input.outcome === "delivered"
        ? {
            status: "delivered",
            deliveredAt: nowDate(),
            providerMessageId: input.providerMessageId,
          }
        : { status: "uncertain" };
  const [row] = await db
    .update(unresolvedSafetyAlertDeliveries)
    .set(update)
    .where(
      and(
        eq(unresolvedSafetyAlertDeliveries.id, input.deliveryId),
        input.outcome === "delivered"
          ? inArray(unresolvedSafetyAlertDeliveries.status, ["sending", "uncertain"])
          : eq(unresolvedSafetyAlertDeliveries.status, "sending"),
        eq(unresolvedSafetyAlertDeliveries.attemptId, input.attemptId),
      ),
    )
    .returning({ id: unresolvedSafetyAlertDeliveries.id });
  return Boolean(row);
}

/** A worker disappearing during dispatch leaves an ambiguous result. It cannot
 * be automatically sent again; a confirmed late success for that same attempt
 * can still settle the uncertainty. */
export async function markInterruptedSafetyReviewDelivery(
  db: DbExecutor,
  deliveryId: string,
  olderThan: Date,
) {
  const [row] = await db
    .update(unresolvedSafetyAlertDeliveries)
    .set({ status: "uncertain" })
    .where(
      and(
        eq(unresolvedSafetyAlertDeliveries.id, deliveryId),
        eq(unresolvedSafetyAlertDeliveries.status, "sending"),
        lt(unresolvedSafetyAlertDeliveries.attemptedAt, olderThan),
      ),
    )
    .returning({ id: unresolvedSafetyAlertDeliveries.id });
  return Boolean(row);
}
