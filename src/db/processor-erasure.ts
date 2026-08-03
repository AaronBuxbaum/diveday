/**
 * The "a processor still holds this erased diver, and only the shop can go and
 * remove it" ledger (ADR 20260803-processor-erasure-obligations).
 *
 * `anonymizeDiver` (src/db/anonymize.ts) can empty every column DiveDay owns.
 * It cannot touch `orders.stripe_customer_id`: that column is `NOT NULL`, the
 * shop needs it for tax and chargeback, and it names a customer object in the
 * shop's own Stripe account carrying the diver's name and email. Before this
 * module, "erasure at the processor" was a sentence in an ADR and nothing in
 * the product — an obligation with no record, owed by nobody in particular.
 *
 * Deliberately a ledger and not a queue. Nothing here calls Stripe: deleting a
 * Stripe customer is irreversible and takes the shop's own invoice trail with
 * it, so the decision belongs to the shop, and a discharged row is the shop's
 * attestation that it did the work — not a fact DiveDay verified. That honesty
 * is the whole design; see the ADR's "What this does not do".
 */

import { and, asc, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { type ProcessorErasureObligation, processorErasureObligations } from "./schema";

export type RecordProcessorErasureObligationsInput = {
  shopId: string;
  /** The erasure that raised these — already anonymized by the time this runs. */
  personId: string;
  /** Distinct Stripe customer ids the erased diver's orders point at. */
  stripeCustomerIds: string[];
};

/**
 * Raise one obligation per processor record the erasure could not reach.
 * Written inside the erasure transaction on purpose: an obligation that only
 * commits if some later step also succeeds is exactly the "we forgot we owed
 * this" failure the ledger exists to prevent, and unlike a provider call there
 * is no network here to keep out of the transaction.
 *
 * Idempotent by `(shop_id, target, external_id)`. A replayed erasure, or a
 * second diver whose orders point at the same customer object, folds into the
 * existing row rather than raising a duplicate for work that is a single
 * delete either way. Returns how many rows this call actually created, so the
 * caller can report "n obligations raised" without counting the folds.
 */
export async function recordProcessorErasureObligations(
  db: DbExecutor,
  input: RecordProcessorErasureObligationsInput,
): Promise<number> {
  const ids = [...new Set(input.stripeCustomerIds.filter((id) => id.trim().length > 0))];
  if (ids.length === 0) return 0;
  const inserted = await db
    .insert(processorErasureObligations)
    .values(
      ids.map((externalId) => ({
        shopId: input.shopId,
        personId: input.personId,
        target: "stripe_customer" as const,
        externalId,
      })),
    )
    .onConflictDoNothing({
      target: [
        processorErasureObligations.shopId,
        processorErasureObligations.target,
        processorErasureObligations.externalId,
      ],
    })
    .returning({ id: processorErasureObligations.id });
  return inserted.length;
}

/**
 * This shop's still-owed obligations, oldest first — the reports-page panel.
 * Shop-scoped in the query, never filtered in the caller: an obligation names a
 * processor record in one shop's Stripe account and has no business being
 * readable from another's.
 */
export async function listOwedProcessorErasures(
  db: AppDb,
  shopId: string,
): Promise<ProcessorErasureObligation[]> {
  return db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.shopId, shopId),
        eq(processorErasureObligations.status, "owed"),
      ),
    )
    .orderBy(asc(processorErasureObligations.createdAt));
}

export type DischargeProcessorErasureResult =
  | { ok: true }
  /** No owed obligation with this id at this shop — wrong shop, or already discharged. */
  | { ok: false; reason: "not_found" };

/**
 * Mark one obligation done, on the word of the staff member who did the work
 * at the processor. `status` and `dischargedAt` move together (the table's
 * check constraint enforces it), and the `status = 'owed'` predicate makes a
 * double-submit a no-op rather than a rewritten attestation.
 */
export async function dischargeProcessorErasure(
  db: AppDb,
  input: { shopId: string; obligationId: string; actorPersonId: string },
): Promise<DischargeProcessorErasureResult> {
  const discharged = await db
    .update(processorErasureObligations)
    .set({
      status: "discharged",
      dischargedAt: nowDate(),
      dischargedByPersonId: input.actorPersonId,
    })
    .where(
      and(
        eq(processorErasureObligations.id, input.obligationId),
        eq(processorErasureObligations.shopId, input.shopId),
        eq(processorErasureObligations.status, "owed"),
      ),
    )
    .returning({ id: processorErasureObligations.id });
  return discharged.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
