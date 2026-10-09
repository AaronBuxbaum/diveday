/**
 * **Which platform secret key a Stripe call on a connected account uses**
 * (ADR 20261009-demo-test-mode-payments).
 *
 * Every shop's money moves through DiveDay's platform key, `STRIPE_SECRET_KEY`,
 * acting on the shop's own Standard account through the `Stripe-Account`
 * header (ADR 20260719-stripe-connect-orders). In production that key is a
 * live key, and a live key on a connected account moves real money.
 *
 * The canonical demo shop takes a card at booking too, so a visitor can check
 * what the marketing pages say about paying at booking. It does that through
 * the very same flow, with one difference: its connected account,
 * `STRIPE_DEMO_ACCOUNT_ID`, is only ever called with the platform's
 * **test-mode** key, `STRIPE_DEMO_SECRET_KEY`. So the demo's checkout is Stripe
 * test mode end to end, and a visitor's card is never charged.
 *
 * The routing is by the account a call is about, which every Stripe call here
 * already names, so there is no second payment path: a provider asks this file
 * for the key and gets the live one for every account but the demo's.
 *
 * **Fails closed both ways.**
 * - A call about the demo account never gets the live key. If the demo
 *   account is configured and its test key is missing or is not a test key,
 *   there is no key for it at all, and the call is not made.
 * - The demo key is only ever a test key: a value that does not start with
 *   `sk_test_` or `rk_test_` is refused, so a live key pasted into the wrong
 *   variable cannot turn the demo into a real till.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** `acct_` and Stripe's own id alphabet. Anything else is not an account id. */
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;

/** A Stripe secret or restricted key in test mode. */
const TEST_MODE_KEY = /^(sk|rk)_test_[A-Za-z0-9]{8,}$/;

/** A Stripe secret or restricted key in live mode. */
const LIVE_MODE_KEY = /^(sk|rk)_live_/;

/** The demo shop's test-mode connection, when both halves are configured and valid. */
export type DemoStripeAccount = { accountId: string; secretKey: string };

export function demoStripeAccount(env: Env = process.env): DemoStripeAccount | null {
  const accountId = env.STRIPE_DEMO_ACCOUNT_ID?.trim() ?? "";
  const secretKey = env.STRIPE_DEMO_SECRET_KEY?.trim() ?? "";
  if (!ACCOUNT_ID.test(accountId) || !TEST_MODE_KEY.test(secretKey)) return null;
  return { accountId, secretKey };
}

/** Whether `stripeAccountId` is the demo's test-mode account, configured in full. */
export function isDemoTestModeAccount(
  stripeAccountId: string | null | undefined,
  env: Env = process.env,
): boolean {
  return Boolean(stripeAccountId) && demoStripeAccount(env)?.accountId === stripeAccountId;
}

/**
 * The platform key for a call on `stripeAccountId`, or null when there is none
 * that may be used for it.
 */
export function stripeSecretKeyFor(stripeAccountId: string, env: Env = process.env): string | null {
  const demoAccountId = env.STRIPE_DEMO_ACCOUNT_ID?.trim();
  if (demoAccountId && stripeAccountId === demoAccountId) {
    return demoStripeAccount(env)?.secretKey ?? null;
  }
  return env.STRIPE_SECRET_KEY?.trim() || null;
}

/** Whether the platform key is a live-mode key: true only on a deployment that moves real money. */
export function platformKeyIsLive(env: Env = process.env): boolean {
  return LIVE_MODE_KEY.test(env.STRIPE_SECRET_KEY?.trim() ?? "");
}

/**
 * How a provider learns its key: a fixed one (a test, or a caller that knows
 * its key), or one chosen per connected account.
 */
export type StripeKeySource =
  | { secretKey: string }
  | { secretKeyFor: (accountId: string) => string | null };

/** Raised instead of making a call that has no key it may use. Every provider catches it as a failure. */
export class StripeKeyUnavailableError extends Error {
  constructor() {
    super("No Stripe key may be used for this connected account");
    this.name = "StripeKeyUnavailableError";
  }
}

/** The key a provider uses for one call. Throws {@link StripeKeyUnavailableError} rather than guess. */
export function secretKeyForCall(source: StripeKeySource, stripeAccountId: string): string {
  const key = "secretKey" in source ? source.secretKey : source.secretKeyFor(stripeAccountId);
  if (!key) throw new StripeKeyUnavailableError();
  return key;
}

/**
 * The key source a `*FromEnvironment` provider is built on, or null when no
 * call could have a key: neither the platform key nor the demo pair is set.
 */
export function stripeKeySourceFromEnvironment(env: Env = process.env): StripeKeySource | null {
  if (!env.STRIPE_SECRET_KEY?.trim() && !demoStripeAccount(env)) return null;
  return { secretKeyFor: (accountId) => stripeSecretKeyFor(accountId, env) };
}
