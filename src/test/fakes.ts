/**
 * Shared provider test doubles.
 *
 * The payment and notification providers are the seams the domain is written
 * against (`CheckoutProvider`, `PromotionProvider`, `NotificationProvider`,
 * `SmsProvider`, `CourtesyProvider`), so nearly every `src/db` test needs a
 * stand-in for one. Those stand-ins used to be copy-pasted per test file and
 * drifted: some grew an `overrides` parameter and some never did, so a test in
 * the wrong file could not express "…but this one call fails" without editing
 * the file's private fake. These are the superset — every fake takes
 * `overrides`, typed against the real interface, so a test bends the default
 * rather than forking it.
 *
 * Each fake is *permissive by default*: the happy path succeeds. A test that
 * needs a refusal states it, which keeps the refusal visible at the call site
 * instead of buried in a file-local default.
 *
 * Keep a local fake only when its behavior is genuinely different in kind — see
 * `src/db/refunds.test.ts`, whose checkout fake models Stripe's captured-amount
 * ceiling per payment intent (PAY-M3). That is a simulator, not a stub.
 */

import { nowMs } from "@/lib/clock";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import type {
  CourtesyDelivery,
  CourtesyMessage,
  CourtesyProvider,
} from "@/lib/notifications/courtesy";
import type { SmsDelivery, SmsMessage, SmsProvider } from "@/lib/notifications/sms";
import type {
  CheckoutProvider,
  CheckoutSessionLookupResult,
  CreateCheckoutSessionResult,
} from "@/lib/payments/checkout";
import type { CreateTripPromotionResult, PromotionProvider } from "@/lib/payments/promotions";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stripe Checkout, faked: every session is created, priced from the line items
 * the caller actually passed, and expires a day out from the (frozen) clock.
 * `retrieveCheckoutSession` fails by default — a test that cares what Stripe
 * says on read-back must say so — and refunds succeed.
 *
 * Session ids count up per instance (`cs_1`, `cs_2`, …) so a test that starts
 * two checkouts gets two distinct sessions, which is what the paid/expired
 * transitions key on.
 */
export function fakeCheckout(overrides: Partial<CheckoutProvider> = {}): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request): Promise<CreateCheckoutSessionResult> {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_${counter}`,
        amountTotalCents: request.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
        expiresAt: new Date(nowMs() + DAY_MS),
      };
    },
    async retrieveCheckoutSession(): Promise<CheckoutSessionLookupResult> {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_test" };
    },
    ...overrides,
  };
}

/**
 * A checkout fake that also records every session request it was handed, for
 * currency and amount assertions. The recorded requests are the *inputs* the
 * domain built, which is the half a returned session cannot show.
 */
export function recordingCheckout(overrides: Partial<CheckoutProvider> = {}): {
  requests: Parameters<CheckoutProvider["createCheckoutSession"]>[0][];
  provider: CheckoutProvider;
} {
  const requests: Parameters<CheckoutProvider["createCheckoutSession"]>[0][] = [];
  const inner = fakeCheckout(overrides);
  const provider = fakeCheckout({
    ...overrides,
    async createCheckoutSession(request) {
      requests.push(request);
      return inner.createCheckoutSession(request);
    },
  });
  return { requests, provider };
}

/**
 * Stripe's promotion API, faked: both trip-scoped and shop-wide code creation
 * succeed, sharing one counter so ids are unique across a single instance
 * (`coupon_1`/`promo_1`, `coupon_2`/`promo_2`, …).
 */
export function fakePromotions(overrides: Partial<PromotionProvider> = {}): PromotionProvider {
  let counter = 0;
  const created = (): CreateTripPromotionResult => {
    counter += 1;
    return {
      status: "created",
      stripeCouponId: `coupon_${counter}`,
      stripePromotionCodeId: `promo_${counter}`,
    };
  };
  return {
    async createTripPromotion(): Promise<CreateTripPromotionResult> {
      return created();
    },
    async createShopPromotion(): Promise<CreateTripPromotionResult> {
      return created();
    },
    ...overrides,
  };
}

/**
 * An email provider that records what it was asked to send and reports
 * `result` for every send. The returned `sent` array is the assertion surface:
 * *which* notifications the domain decided to send is the behavior under test,
 * not the transport.
 */
export function fakeEmail(
  result: NotificationDelivery = { status: "sent", providerMessageId: "em_1" },
  overrides: Partial<NotificationProvider> = {},
): { sent: Notification[]; provider: NotificationProvider } {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return result;
    },
    ...overrides,
  };
  return { sent, provider };
}

/** As {@link fakeEmail}, for the SMS transport. */
export function fakeSms(
  result: SmsDelivery = { status: "sent", providerMessageId: "SM_1" },
  overrides: Partial<SmsProvider> = {},
): { sent: SmsMessage[]; provider: SmsProvider } {
  const sent: SmsMessage[] = [];
  const provider: SmsProvider = {
    async send(message) {
      sent.push(message);
      return result;
    },
    ...overrides,
  };
  return { sent, provider };
}

/** As {@link fakeEmail}, for a shop's own WhatsApp sender (the courtesy channel). */
export function fakeCourtesy(
  result: CourtesyDelivery = { status: "sent", providerMessageId: "wamid.1" },
  overrides: Partial<CourtesyProvider> = {},
): { sent: CourtesyMessage[]; provider: CourtesyProvider } {
  const sent: CourtesyMessage[] = [];
  const provider: CourtesyProvider = {
    async send(message) {
      sent.push(message);
      return result;
    },
    ...overrides,
  };
  return { sent, provider };
}
