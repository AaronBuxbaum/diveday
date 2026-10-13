import { z } from "zod";
import { ERASURE_FAILURE_DETAIL } from "./erasure-failure";
import { boundedStripeFetch } from "./stripe-fetch";
import { type StripeKeySource, secretKeyForCall } from "./stripe-keys";

/**
 * Customer deletion on a shop's connected Stripe account — the processor half
 * of diver erasure (ADR 20260803-processor-erasure-obligations). Every call
 * carries a `Stripe-Account` header so the delete lands in the shop's own
 * account, not the platform's (docs ADR 20260719-stripe-connect-orders).
 * Fetch-based, no SDK — same pattern as ./invoicing.ts and ./connect.ts.
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

/**
 * Stripe's error envelope. Only `code` and `type` are read: both come from
 * Stripe's fixed vocabulary (`resource_missing`, `invalid_request_error`).
 * `message` is free text that can quote the object or input Stripe refused, so
 * it is never parsed at all (issue #2334).
 */
const errorResponseSchema = z.object({
  error: z.object({ code: z.string().optional(), type: z.string().optional() }).optional(),
});

/** A Stripe code or type is a short snake_case token; anything else is dropped. */
const STRIPE_ERROR_TOKEN = /^[a-z0-9_]{1,64}$/;

/**
 * A short, non-identifying reason for the ledger's `last_error`: the HTTP
 * status, plus Stripe's error code (or, without one, its error type) when that
 * is a plain token. Never Stripe's `message`, which this column must not hold.
 */
async function failureFrom(response: Response): Promise<{ status: "failed"; error: string }> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = errorResponseSchema.safeParse(await response.json());
    const token = body.success ? (body.data.error?.code ?? body.data.error?.type) : undefined;
    if (token && STRIPE_ERROR_TOKEN.test(token)) detail = `${detail}: ${token}`;
  } catch {
    // A non-JSON body (a gateway's HTML error page) leaves the status alone.
  }
  return { status: "failed", error: detail };
}

export function stripeCustomerProvider(
  config: StripeKeySource,
  unboundedFetch: Fetch,
): CustomerProvider {
  const fetchImpl = boundedStripeFetch(unboundedFetch);
  return {
    async deleteCustomer(stripeAccountId, stripeCustomerId, idempotencyKey) {
      try {
        const response = await fetchImpl(
          `https://api.stripe.com/v1/customers/${encodeURIComponent(stripeCustomerId)}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${await secretKeyForCall(config, stripeAccountId)}`,
              "Stripe-Account": stripeAccountId,
              "Idempotency-Key": idempotencyKey,
            },
          },
        );
        // Already gone. The end state the caller wants holds, so this is not a
        // failure to retry forever — it is what a replayed delete looks like.
        if (response.status === 404) return { status: "already_deleted" };
        if (!response.ok) return await failureFrom(response);
        // Stripe answers `deleted: true` and nothing else counts. A 2xx that
        // does not say so — `deleted: false`, the field absent, a body that is
        // not the deleted-object envelope at all — leaves the obligation owed
        // and visible, because calling it deleted would be a lie in a
        // compliance ledger. Failing here costs a retry; failing open costs an
        // attestation that a diver's data is gone from Stripe when it is not.
        const body = deletedResponseSchema.safeParse(await response.json());
        return body.success
          ? { status: "deleted" }
          : { status: "failed", error: ERASURE_FAILURE_DETAIL.notConfirmed };
      } catch {
        // Never the thrown text: a network error's message can carry a
        // request fragment, and this lands in a ledger column (issue #2239).
        return { status: "failed", error: ERASURE_FAILURE_DETAIL.unanswered };
      }
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
