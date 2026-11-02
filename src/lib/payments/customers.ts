import { z } from "zod";
import { ERASURE_FAILURE_DETAIL } from "./erasure-failure";
import { stripeAnsweredStatus, stripeErrorTokens, stripeRequest } from "./stripe-client";
import { type StripeKeySource, secretKeyForCall } from "./stripe-keys";

/**
 * Customer deletion on a shop's connected Stripe account — the processor half
 * of diver erasure (ADR 20260803-processor-erasure-obligations). Every call
 * carries a `Stripe-Account` header so the delete lands in the shop's own
 * account, not the platform's (docs ADR 20260719-stripe-connect-orders).
 * Through the SDK's request path in ./stripe-client.ts, as ./invoicing.ts is.
 *
 * `DELETE /v1/customers/{id}` removes the customer's sensitive data (card
 * details and payment methods) and cancels any active subscriptions. It does
 * *not* destroy charges, invoices, refunds or disputes — those are separate
 * objects and survive, so the shop's tax and chargeback trail survives with
 * them, and the deleted customer itself stays retrievable through the API for
 * history. DiveDay creates no subscriptions on connected accounts, so that side
 * effect is moot here. The ADR carries the full reasoning; it is recorded there
 * because the opposite conclusion (that a delete would destroy the shop's
 * financial records) is the intuitive-but-wrong one.
 */

export type DeleteCustomerResult =
  /** The customer is gone from Stripe — this call did it. */
  | { status: "deleted" }
  /**
   * Stripe has no such customer on this account. Treated as success by callers:
   * the desired end state holds, and a 404 is what a replayed delete looks like.
   */
  | { status: "already_deleted" }
  /** No Stripe secret key configured — the deployment cannot reach Stripe at all. */
  | { status: "not_configured" }
  /** The call was made and did not succeed. `error` is the HTTP status and Stripe code for the ledger. */
  | { status: "failed"; error: string };

export interface CustomerProvider {
  /**
   * `idempotencyKey` follows the house pattern (`idempotencyKeyFor`,
   * src/db/payment-operations.ts) even though deletion is idempotent by
   * construction: a retry of the *same* logical attempt should read to Stripe
   * as the same request, and passing the key costs nothing.
   */
  deleteCustomer(
    stripeAccountId: string,
    stripeCustomerId: string,
    idempotencyKey: string,
  ): Promise<DeleteCustomerResult>;
}

type Fetch = typeof fetch;

/**
 * Stripe's deleted-object envelope. `deleted` is **required and must be true**:
 * this result is written into a compliance ledger as an attestation that the
 * customer is gone, so a 2xx body that merely echoes an `id` — a customer
 * object Stripe returned without deleting anything, a proxy's rewritten
 * response — must not discharge the obligation.
 */
const deletedResponseSchema = z.object({
  id: z.string().min(1),
  deleted: z.literal(true),
});

/** A Stripe code or type is a short snake_case token; anything else is dropped. */
const STRIPE_ERROR_TOKEN = /^[a-z0-9_]{1,64}$/;

/**
 * A short, non-identifying reason for the ledger's `last_error`: the HTTP
 * status, plus Stripe's error code (or, without one, its error type) when that
 * is a plain token. Never Stripe's `message`, which this column must not hold
 * (issue #2334).
 */
function failureFrom(status: number, error: unknown): { status: "failed"; error: string } {
  const tokens = stripeErrorTokens(error);
  const token = tokens.code ?? tokens.type;
  const detail =
    token && STRIPE_ERROR_TOKEN.test(token) ? `HTTP ${status}: ${token}` : `HTTP ${status}`;
  return { status: "failed", error: detail };
}

export function stripeCustomerProvider(
  config: StripeKeySource,
  fetchImpl: Fetch,
): CustomerProvider {
  return {
    async deleteCustomer(stripeAccountId, stripeCustomerId, idempotencyKey) {
      let answer: unknown;
      try {
        answer = await stripeRequest(await secretKeyForCall(config, stripeAccountId), fetchImpl, {
          method: "DELETE",
          path: `/v1/customers/${encodeURIComponent(stripeCustomerId)}`,
          stripeAccount: stripeAccountId,
          idempotencyKey,
        });
      } catch (error) {
        const status = stripeAnsweredStatus(error);
        // Already gone. The end state the caller wants holds, so this is not a
        // failure to retry forever — it is what a replayed delete looks like.
        if (status === 404) return { status: "already_deleted" };
        if (status !== null) return failureFrom(status, error);
        // Never the thrown text: a network error's message can carry a
        // request fragment, and this lands in a ledger column (issue #2239).
        return { status: "failed", error: ERASURE_FAILURE_DETAIL.unanswered };
      }
      // Stripe answers `deleted: true` and nothing else counts. A 2xx that
      // does not say so — `deleted: false`, the field absent, a body that is
      // not the deleted-object envelope at all — leaves the obligation owed
      // and visible, because calling it deleted would be a lie in a
      // compliance ledger. Failing here costs a retry; failing open costs an
      // attestation that a diver's data is gone from Stripe when it is not.
      return deletedResponseSchema.safeParse(answer).success
        ? { status: "deleted" }
        : { status: "failed", error: ERASURE_FAILURE_DETAIL.notConfirmed };
    },
  };
}

const disabledCustomerProvider: CustomerProvider = {
  async deleteCustomer() {
    return { status: "not_configured" };
  },
};

/**
 * The provider over a key source, or the one that answers `not_configured` when
 * there is none. The key source is built in `src/db/stripe-providers.ts`
 * (`customerProviderFromEnvironment`), because choosing a key reads who holds the
 * connected account, and that is a database read this layer does not make.
 */
export function customerProviderFor(
  keys: StripeKeySource | null,
  fetchImpl: Fetch = fetch,
): CustomerProvider {
  return keys ? stripeCustomerProvider(keys, fetchImpl) : disabledCustomerProvider;
}
