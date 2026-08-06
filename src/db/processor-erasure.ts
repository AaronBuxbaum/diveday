/**
 * The processor half of diver erasure (ADR 20260803-processor-erasure-obligations).
 *
 * `anonymizeDiver` (src/db/anonymize.ts) empties every column DiveDay owns. Two
 * `NOT NULL` pointers on `orders` name records that live at Stripe instead, and
 * this module is what happens to them:
 *
 *   - **`stripe_customer_id` → deleted.** `DELETE /v1/customers/{id}` on the
 *     shop's connected account removes the customer's sensitive data and leaves
 *     charges, invoices, refunds and disputes standing, so the shop's tax and
 *     chargeback trail survives it. DiveDay creates no subscriptions on
 *     connected accounts, so the cancel-subscriptions side effect does not
 *     apply here. (The intuitive objection — "deleting the customer destroys the
 *     shop's financial records" — is wrong, and the ADR records why so nobody
 *     re-litigates it from memory.)
 *   - **`stripe_invoice_id` → recorded, not deleted.** Stripe snapshots
 *     `customer_name`/`customer_email` onto an invoice at finalization, and no
 *     API call rewrites that copy; Stripe handles Invoice/PaymentIntent/Charge
 *     through its own data-deletion request flow. That is a genuinely manual
 *     step, so it is recorded as one rather than quietly implied to be done.
 *
 * **The delete never runs inside the erasure transaction, and never gates it.**
 * The obligation row commits with the scrub; the Stripe call happens after. A
 * dead network, a Stripe outage or a revoked Connect token must not roll back an
 * erasure a diver asked for — it must leave a visible, retryable `owed` row,
 * which is exactly the `mediaDeletionAttempts` shape (CR-012) one processor
 * over.
 */

import { and, asc, eq, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type CustomerProvider, customerProviderFromEnvironment } from "@/lib/payments/customers";
import type { AppDb, DbExecutor } from "./client";
import { idempotencyKeyFor } from "./payment-operations";
import {
  type ProcessorErasureObligation,
  type ProcessorErasureTarget,
  processorErasureObligations,
  shopStripeAccounts,
} from "./schema";

/**
 * How many delete attempts a `stripe_customer` obligation gets from the
 * automatic retry before it stops being retried on a schedule. It stays `owed`
 * and owner-visible forever after that — the point of a cap is that a
 * permanently broken delete (a revoked Connect token, a deleted account) stops
 * burning a Stripe call every night and starts being a human's problem, not
 * that DiveDay forgets it.
 */
export const MAX_AUTOMATIC_DELETE_ATTEMPTS = 5;

export type ProcessorErasureTargetInput = {
  target: ProcessorErasureTarget;
  externalId: string;
  stripeAccountId: string;
};

export type RecordProcessorErasureObligationsInput = {
  shopId: string;
  /** The erasure that raised these — already anonymized by the time this runs. */
  personId: string;
  targets: ProcessorErasureTargetInput[];
};

/**
 * Raise one obligation per processor record the local scrub could not reach.
 * Written inside the erasure transaction on purpose: an obligation that only
 * commits if some later step also succeeds is exactly the "we forgot we owed
 * this" failure the ledger exists to prevent, and unlike the delete call itself
 * there is no network here to keep out of the transaction.
 *
 * Idempotent on `(shop_id, target, external_id)`. A replayed erasure, or a
 * second diver whose orders point at the same customer object, folds onto the
 * existing row rather than raising a duplicate for work that is one delete
 * either way.
 *
 * Returns the rows this call created, so the caller can attempt exactly those
 * deletes once the transaction has committed.
 */
export async function recordProcessorErasureObligations(
  db: DbExecutor,
  input: RecordProcessorErasureObligationsInput,
): Promise<ProcessorErasureObligation[]> {
  const seen = new Set<string>();
  const values = input.targets
    .filter(
      (entry) => entry.externalId.trim().length > 0 && entry.stripeAccountId.trim().length > 0,
    )
    .filter((entry) => {
      const key = `${entry.target}:${entry.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      shopId: input.shopId,
      personId: input.personId,
      target: entry.target,
      externalId: entry.externalId,
      stripeAccountId: entry.stripeAccountId,
    }));
  if (values.length === 0) return [];
  return db
    .insert(processorErasureObligations)
    .values(values)
    .onConflictDoNothing({
      target: [
        processorErasureObligations.shopId,
        processorErasureObligations.target,
        processorErasureObligations.externalId,
      ],
    })
    .returning();
}

/**
 * This shop's still-owed obligations, oldest first — the panel in Settings'
 * "Data & integrations" group.
 * Shop-scoped in the query, never filtered in the caller: an obligation names a
 * record in one shop's Stripe account and has no business being readable from
 * another's.
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

export type AttemptProcessorErasureOutcome =
  /** The customer is gone from Stripe (this call did it, or it already was). */
  | { status: "discharged" }
  /** The call was made or could not be made; the row stays `owed` and visible. */
  | { status: "failed"; error: string }
  /** Not a target any API can discharge — an invoice snapshot needs a human. */
  | { status: "manual" };

/**
 * Attempt the one obligation that has an API behind it, and record the outcome.
 *
 * Deliberately takes an already-loaded row rather than an id: the caller is
 * `anonymizeDiver`, immediately after its transaction commits, and it holds the
 * rows it just wrote. Nobody's *permission* is re-checked here — the erasure
 * that raised the row was owner-gated, and this is that decision being carried
 * out — but the connected account the row names is re-proved to still belong to
 * the row's shop before any destructive call goes out (see below).
 */
export async function attemptProcessorErasure(
  db: DbExecutor,
  obligation: ProcessorErasureObligation,
  provider: CustomerProvider,
): Promise<AttemptProcessorErasureOutcome> {
  if (obligation.target !== "stripe_customer") return { status: "manual" };
  if (obligation.status === "discharged") return { status: "discharged" };

  // Re-prove the snapshotted account still belongs to this obligation's shop
  // before firing a destructive call at it. The `(stripeAccountId, externalId)`
  // pair was genuinely shop-owned when the row was raised and is deliberately
  // never re-derived, but the delete goes out on the *platform* key, which can
  // act on every connected account: if shop A reconnected under a new account
  // (freeing `acct_X`) and shop B has since connected `acct_X`, A's old
  // obligation would aim `DELETE /v1/customers` at a tenant that never asked
  // for it. Exotic, and cheap to make impossible. An account that maps to
  // nobody is refused too — an unprovable pair is not a pair to fire at, and
  // the platform has no authorization on a deauthorized account anyway, so the
  // call could only have failed. Either way the row stays `owed` and the owner
  // can close it by attestation.
  const owned = await accountBelongsToShop(db, obligation.stripeAccountId, obligation.shopId);
  if (!owned) return recordFailedAttempt(db, obligation, "stripe account not owned by this shop");

  const result = await provider.deleteCustomer(
    obligation.stripeAccountId,
    obligation.externalId,
    // The attempt ordinal is part of the key on purpose. Stripe caches the
    // response for an idempotency key for 24h *including errors*, so a key
    // derived from the obligation id alone replayed the cached failure at an
    // owner who had just fixed the problem and clicked Retry: attempts went up,
    // `last_error` never changed, and no call was really made. Deletion is
    // idempotent by construction, so a distinct key per attempt costs nothing.
    idempotencyKeyFor(obligation.id, `customer-delete-${obligation.attempts + 1}`),
  );

  if (result.status === "deleted" || result.status === "already_deleted") {
    await db
      .update(processorErasureObligations)
      .set({
        status: "discharged",
        dischargedAt: nowDate(),
        attempts: obligation.attempts + 1,
        lastError: null,
      })
      .where(eq(processorErasureObligations.id, obligation.id));
    return { status: "discharged" };
  }

  // `not_configured` is a failure like any other here, and deliberately so: a
  // deployment with no Stripe key has not erased anything at the processor, and
  // a ledger that quietly discharged the row would be claiming otherwise.
  const error = result.status === "not_configured" ? "stripe not configured" : result.error;
  return recordFailedAttempt(db, obligation, error);
}

/**
 * Is this connected account still the one the shop holds? Read directly rather
 * than through `getShopStripeAccountByAccountId` so the shop predicate is in
 * the query — a row that has moved to another tenant must come back as "no",
 * not as somebody else's row for the caller to compare.
 */
async function accountBelongsToShop(
  db: DbExecutor,
  stripeAccountId: string,
  shopId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ shopId: shopStripeAccounts.shopId })
    .from(shopStripeAccounts)
    .where(
      and(
        eq(shopStripeAccounts.stripeAccountId, stripeAccountId),
        eq(shopStripeAccounts.shopId, shopId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * One place that burns an attempt and records why, so every failure path —
 * Stripe's, and the ones that never reach Stripe — leaves the same shape on
 * the row: still `owed`, still visible, with the reason an owner can read.
 */
async function recordFailedAttempt(
  db: DbExecutor,
  obligation: ProcessorErasureObligation,
  error: string,
): Promise<{ status: "failed"; error: string }> {
  await db
    .update(processorErasureObligations)
    .set({ attempts: obligation.attempts + 1, lastError: error })
    .where(eq(processorErasureObligations.id, obligation.id));
  return { status: "failed", error };
}

/**
 * Attempt every obligation a just-committed erasure raised. Failures are
 * swallowed by design — the local erasure has already happened and is not
 * reversible, so the only thing a throw here could accomplish is to make a
 * completed erasure look like it failed. The count of what is still owed is the
 * honest signal, and it is what the caller returns.
 */
export async function attemptProcessorErasures(
  db: DbExecutor,
  obligations: ProcessorErasureObligation[],
  provider: CustomerProvider,
): Promise<{ discharged: number; stillOwed: number }> {
  let discharged = 0;
  let stillOwed = 0;
  for (const obligation of obligations) {
    try {
      const outcome = await attemptProcessorErasure(db, obligation, provider);
      if (outcome.status === "discharged") discharged += 1;
      else stillOwed += 1;
    } catch (error) {
      // The provider seam already turns a network failure into a `failed`
      // result, so reaching here means something further out broke — the
      // bookkeeping UPDATE, say. The row is still `owed` in that case, which is
      // the safe direction, and one obligation's problem must not stop the
      // others from being attempted.
      stillOwed += 1;
      log("anonymize.processor_erasure_attempt_threw", "error", {
        shopId: obligation.shopId,
        obligationId: obligation.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { discharged, stillOwed };
}

export type RetryProcessorErasureResult =
  | { ok: true; outcome: AttemptProcessorErasureOutcome }
  /** No owed obligation with this id at this shop — wrong shop, or already discharged. */
  | { ok: false; reason: "not_found" };

/**
 * The owner-visible "Retry" for one obligation, scoped to the shop. Mirrors
 * `retryMediaDeletion` (src/db/media-deletions.ts): re-read the row *under the
 * shop scope* before doing anything with it, so an id from another tenant
 * resolves to nothing rather than to a delete on somebody else's account.
 */
export async function retryProcessorErasure(
  db: AppDb,
  shopId: string,
  obligationId: string,
  provider: CustomerProvider = customerProviderFromEnvironment(),
): Promise<RetryProcessorErasureResult> {
  const [obligation] = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.id, obligationId),
        eq(processorErasureObligations.shopId, shopId),
        eq(processorErasureObligations.status, "owed"),
      ),
    );
  if (!obligation) return { ok: false, reason: "not_found" };
  return { ok: true, outcome: await attemptProcessorErasure(db, obligation, provider) };
}

/**
 * Bounded cross-shop retry for the nightly tick, mirroring
 * `retryPendingMediaDeletions`: a transient Stripe outage must not require an
 * owner to notice the reports panel and click Retry by hand. Only
 * `stripe_customer` rows under the attempt cap are eligible — an invoice
 * snapshot has no API to retry, and a row past the cap is a standing human
 * problem rather than a nightly Stripe call.
 *
 * **The cap is in the query, not in the caller.** A capped row stays `owed`
 * forever by design and keeps its original `created_at`, so it sits at the head
 * of this oldest-first, cross-shop scan permanently. Filtering after a `LIMIT`
 * meant that once ~`limit` capped rows existed *anywhere on the platform*, the
 * scan fetched the same dead rows every night, discarded them all, and returned
 * `attempted: 0` — every other shop's genuinely transient failure silently
 * stopped being retried, and the log read exactly like "nothing due".
 */
export async function retryPendingProcessorErasures(
  db: AppDb,
  options: { limit?: number; provider?: CustomerProvider } = {},
): Promise<{ attempted: number; discharged: number }> {
  const limit = options.limit ?? 25;
  const provider = options.provider ?? customerProviderFromEnvironment();
  const eligible = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.status, "owed"),
        eq(processorErasureObligations.target, "stripe_customer"),
        lt(processorErasureObligations.attempts, MAX_AUTOMATIC_DELETE_ATTEMPTS),
      ),
    )
    .orderBy(asc(processorErasureObligations.createdAt))
    .limit(limit);

  let discharged = 0;
  for (const obligation of eligible) {
    const outcome = await attemptProcessorErasure(db, obligation, provider);
    if (outcome.status === "discharged") discharged += 1;
  }
  return { attempted: eligible.length, discharged };
}

export type DischargeProcessorErasureResult =
  | { ok: true }
  /** No owed obligation with this id at this shop — wrong shop, or already discharged. */
  | { ok: false; reason: "not_found" };

/**
 * Mark one obligation done on a human's word. This is the *only* way a
 * `stripe_invoice_snapshot` row ever closes — nothing automated can reach a
 * finalized invoice's name/email snapshot, so an owner attests they filed
 * Stripe's data-deletion request. It also stays available for a
 * `stripe_customer` row whose delete cannot be made to work (an account that no
 * longer exists, say) and which the owner has resolved by other means.
 *
 * `status` and `dischargedAt` move together (the table's check constraint
 * enforces it), and the `status = 'owed'` predicate makes a double-submit a
 * no-op rather than a rewritten attestation.
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
