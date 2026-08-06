import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Stripe contract fixtures, pinned to one API version.
 *
 * The payments seam is tested by injecting a fake `fetch` (see
 * `checkout.test.ts`, `invoicing.test.ts`, …), which means every one of those
 * tests asserts against a payload **the test itself invented**. If Stripe's
 * real response shape differs from what the code parses, all of them still
 * pass. These fixtures are the missing half: real-shaped payloads that the
 * production parsers are driven with, so a shape the code cannot read fails the
 * suite instead of failing a shop's refund.
 *
 * See ./<version>/ for the payloads and ../../stripe-contract.test.ts for what
 * they prove. Re-capture instructions and the hand-authored caveat are in
 * ./README.md.
 */

/**
 * The Stripe API version every fixture in this directory is shaped for, and the
 * name of the directory that holds them — so each file names its own version by
 * its path rather than by a field Stripe does not send on bare objects.
 *
 * **This is the only place the version is written down.** `stripe-api-version.test.ts`
 * asserts the directory, every event's own `api_version`, and any version the
 * production code pins all agree with it, so a bump cannot land without a
 * re-capture.
 */
export const STRIPE_FIXTURE_API_VERSION = "2026-07-29.dahlia";

export const STRIPE_FIXTURE_DIR = path.join(import.meta.dirname, STRIPE_FIXTURE_API_VERSION);

/** Bare API response objects, as `GET`/`POST /v1/...` returns them. */
export type StripeObjectFixture =
  | "account"
  | "checkout-session.open"
  | "checkout-session.paid-expanded-payment-intent"
  | "coupon"
  | "customer"
  | "customer.deleted"
  | "error.invalid-expand-payment-intent"
  | "invoice.open"
  | "invoice.paid"
  | "oauth-token"
  | "promotion-code"
  | "refund";

/** Webhook `Event` envelopes, exactly the set `src/app/api/webhooks/stripe/route.ts` dispatches on. */
export type StripeEventFixture =
  | "account.application.deauthorized"
  | "account.updated"
  | "checkout.session.async_payment_failed"
  | "checkout.session.async_payment_succeeded"
  | "checkout.session.completed"
  | "checkout.session.expired"
  | "invoice.paid"
  | "invoice.voided";

export const STRIPE_OBJECT_FIXTURES: readonly StripeObjectFixture[] = [
  "account",
  "checkout-session.open",
  "checkout-session.paid-expanded-payment-intent",
  "coupon",
  "customer",
  "customer.deleted",
  "error.invalid-expand-payment-intent",
  "invoice.open",
  "invoice.paid",
  "oauth-token",
  "promotion-code",
  "refund",
];

export const STRIPE_EVENT_FIXTURES: readonly StripeEventFixture[] = [
  "account.application.deauthorized",
  "account.updated",
  "checkout.session.async_payment_failed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.voided",
];

function load(kind: "objects" | "events", name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(STRIPE_FIXTURE_DIR, kind, `${name}.json`), "utf8"));
}

/** One bare Stripe object, parsed. A fresh copy per call — tests may mutate. */
export function stripeObjectFixture(name: StripeObjectFixture): Record<string, unknown> {
  return load("objects", name);
}

/** One Stripe `Event` envelope, parsed. A fresh copy per call — tests may mutate. */
export function stripeEventFixture(name: StripeEventFixture): Record<string, unknown> {
  return load("events", name);
}

/**
 * The raw JSON text of an event, byte for byte as it sits on disk.
 *
 * Webhook signature verification signs the **exact bytes of the request body**,
 * so a test that re-serialises a parsed object is testing its own
 * `JSON.stringify`, not Stripe's payload. This is what `verifyStripeWebhook`
 * must be handed.
 */
export function stripeEventFixtureRaw(name: StripeEventFixture): string {
  return readFileSync(path.join(STRIPE_FIXTURE_DIR, "events", `${name}.json`), "utf8");
}
