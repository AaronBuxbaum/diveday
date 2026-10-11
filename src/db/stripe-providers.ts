import { type CheckoutProvider, checkoutProviderFor } from "@/lib/payments/checkout";
import { type CustomerProvider, customerProviderFor } from "@/lib/payments/customers";
import { type InvoicingProvider, invoicingProviderFor } from "@/lib/payments/invoicing";
import { type PromotionProvider, promotionProviderFor } from "@/lib/payments/promotions";
import {
  demoStripeAccount,
  platformKeyIsTestMode,
  stripeSecretKeyFor,
} from "@/lib/payments/stripe-keys";
import { type DbExecutor, getDb } from "./client";
import { stripeAccountHolder } from "./stripe-accounts";

type PaymentEnvironment = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;

/**
 * The key source every Stripe provider is built on from the environment, or
 * null when no call could have a key. Each call's key is chosen by its account
 * and by who holds that account, read fresh (ADR
 * 20261009-demo-test-mode-payments). It lives apart from `./stripe-accounts`
 * because it reads the database itself, and `./stripe-accounts` is reached
 * from `./client`'s own bootstrap (`./demo-refresh`), which must not import
 * `./client` back (`import-cycles.test.ts`).
 */
export function stripeKeySourceFromEnvironment(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    db?: () => Promise<DbExecutor>;
  } = {},
): { secretKeyFor: (accountId: string) => Promise<string | null> } | null {
  const env = options.env ?? process.env;
  const database = options.db ?? getDb;
  if (!env.STRIPE_SECRET_KEY?.trim() && !demoStripeAccount(env)) return null;
  // Who holds the account changes the answer only for the demo's own account,
  // or when the platform key is not plainly test mode (where a demo shop must
  // get none); a test-mode or absent platform key answers the same for every
  // holder, and is not read for.
  // (The demo's account with no valid pair gets no key whoever holds it.)
  const holderMatters = (accountId: string) =>
    accountId === env.STRIPE_DEMO_ACCOUNT_ID?.trim()
      ? demoStripeAccount(env) !== null
      : Boolean(env.STRIPE_SECRET_KEY?.trim()) && !platformKeyIsTestMode(env);
  return {
    secretKeyFor: async (accountId) => {
      if (!holderMatters(accountId)) {
        return stripeSecretKeyFor(accountId, { isDemo: false, isCanonicalDemo: false }, env);
      }
      return stripeSecretKeyFor(
        accountId,
        await stripeAccountHolder(await database(), accountId),
        env,
      );
    },
  };
}

/*
 * The four connected-account providers as the app builds them: the
 * environment's key source, or `not_configured` without one. Here rather than
 * beside each provider in `src/lib/payments/`, because the key source reads
 * the database and `src/lib` takes only types from `src/db`
 * (`check:architecture`); keeping them there is what put
 * `lib/payments/{checkout,promotions,invoicing}.ts` inside the `client.ts`
 * import cycle. Per connected account, the demo's is called only with the
 * test-mode key (src/lib/payments/stripe-keys.ts, ADR
 * 20261009-demo-test-mode-payments).
 */

export function checkoutProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): CheckoutProvider {
  return checkoutProviderFor(stripeKeySourceFromEnvironment({ env }), fetchImpl);
}

export function customerProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): CustomerProvider {
  return customerProviderFor(stripeKeySourceFromEnvironment({ env }), fetchImpl);
}

export function invoicingProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): InvoicingProvider {
  return invoicingProviderFor(stripeKeySourceFromEnvironment({ env }), fetchImpl);
}

export function promotionProviderFromEnvironment(
  env: PaymentEnvironment = process.env,
  fetchImpl: Fetch = fetch,
): PromotionProvider {
  return promotionProviderFor(stripeKeySourceFromEnvironment({ env }), fetchImpl);
}
