import { z } from "zod";

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
  /** The call was made and did not succeed. `error` is a short code/message for the ledger. */
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
type PaymentEnvironment = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({ secretKey: z.string().trim().min(1) });

const deletedResponseSchema = z.object({
  id: z.string().min(1),
  deleted: z.boolean().optional(),
});

/** Stripe's error envelope, for a message worth putting in front of an owner. */
const errorResponseSchema = z.object({
  error: z.object({ message: z.string().optional(), code: z.string().optional() }).optional(),
});

/**
 * A short, non-identifying reason for the ledger's `last_error`. Stripe error
 * messages describe the *call*, not the diver, so nothing here reintroduces the
 * identity the erasure just removed — but it is truncated anyway, because an
 * unbounded provider string does not belong in a column an owner reads.
 */
async function failureFrom(response: Response): Promise<{ status: "failed"; error: string }> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = errorResponseSchema.safeParse(await response.json());
    const message = body.success ? (body.data.error?.code ?? body.data.error?.message) : undefined;
    if (message) detail = `${detail}: ${message}`;
  } catch {
    // A non-JSON body (a gateway's HTML error page) leaves the status alone.
  }
  return { status: "failed", error: detail.slice(0, 200) };
}

export function stripeCustomerProvider(
  config: { secretKey: string },
  fetchImpl: Fetch,
): CustomerProvider {
  return {
    async deleteCustomer(stripeAccountId, stripeCustomerId, idempotencyKey) {
      try {
        const response = await fetchImpl(
          `https://api.stripe.com/v1/customers/${encodeURIComponent(stripeCustomerId)}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${config.secretKey}`,
              "Stripe-Account": stripeAccountId,
              "Idempotency-Key": idempotencyKey,
            },
          },
        );
        // Already gone. The end state the caller wants holds, so this is not a
        // failure to retry forever — it is what a replayed delete looks like.
        if (response.status === 404) return { status: "already_deleted" };
        if (!response.ok) return await failureFrom(response);
        const body = deletedResponseSchema.safeParse(await response.json());
        if (!body.success) return { status: "failed", error: "unexpected response" };
        // Stripe answers `deleted: true`; anything else means the object is
        // still there and calling it deleted would be a lie in a compliance
        // ledger.
        return body.data.deleted === false
          ? { status: "failed", error: "stripe did not report the customer deleted" }
          : { status: "deleted" };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : "network error" };
      }
    },
  };
}

const disabledCustomerProvider: CustomerProvider = {
  async deleteCustomer() {
    return { status: "not_configured" };
  },
};

export function customerProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): CustomerProvider {
  const config = configSchema.safeParse({ secretKey: env.STRIPE_SECRET_KEY });
  return config.success ? stripeCustomerProvider(config.data, fetchImpl) : disabledCustomerProvider;
}
