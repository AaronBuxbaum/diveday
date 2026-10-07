import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

/**
 * Where a shop stands with DiveDay's own subscription — the one answer to "is
 * this shop paid up?" (ADR 20261007-subscription-billing).
 *
 * Pure on purpose. Every input is a fact somebody else recorded: the shop's
 * trial window (`src/lib/trial.ts`), the free term DiveDay granted by hand
 * (`shop_subscriptions.free_term_ends_on`), and the last subscription state
 * Stripe's webhook told us. Nothing here reads a clock or a table, so the
 * Billing page, a future digest, and a future gate all ask the same question
 * the same way.
 *
 * **Nothing reads `isInGoodStanding` to lock a shop out.** That is a product
 * decision, not an oversight: this change records and shows billing state
 * and stops there. The function exists so the day a gate is wanted it is one
 * call, already tested, rather than a second reading of the same columns.
 */

/**
 * Stripe's own subscription statuses, mirrored as stored rather than mapped
 * on the way in, so a status Stripe adds later fails the webhook's parse
 * loudly instead of being squeezed into the nearest word we had.
 */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type StripeSubscriptionStatus = (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

/**
 * What the Billing page says, as a code (the page picks the words).
 *
 * - `trialing` — inside the three-week trial, card or not.
 * - `free_term` — inside a free term DiveDay granted by hand, card or not.
 * - `active` — paying, and the last charge went through.
 * - `past_due` — Stripe could not collect the last charge.
 * - `canceled` — the subscription ended.
 * - `trial_ended` — the free window is over and no card was ever added.
 */
export type BillingStatus =
  | "trialing"
  | "free_term"
  | "active"
  | "past_due"
  | "canceled"
  | "trial_ended";

export type SubscriptionSnapshot = {
  status: StripeSubscriptionStatus;
  /** When the current period ends: the next charge, or the first one during a Stripe-side trial. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingStandingInput = {
  now: Date;
  /** The shop's own zone: a free term ends at the end of its last day *there*. */
  timeZone: string;
  /** When the shop's trial ends (`trialEndsAt(shop.createdAt)`). */
  trialEndsAt: Date;
  /** The last day of a hand-granted free term, inclusive; null when none was granted. */
  freeTermEndsOn: CalendarDate | null;
  /** Null until the owner has added a card and Stripe has told us about it. */
  subscription: SubscriptionSnapshot | null;
};

export type BillingStanding = {
  status: BillingStatus;
  /** True when a subscription exists that Stripe will charge (a card is on file). */
  hasSubscription: boolean;
  /** The next charge, when one is scheduled; null when nothing will be charged. */
  nextChargeAt: Date | null;
  /** When a canceled-at-period-end subscription stops; null otherwise. */
  endsAt: Date | null;
  /** When the free time (trial or free term) ends; null once it already has. */
  freeUntil: Date | null;
};

/** The instant a free term whose last day is `endsOn` stops, in the shop's own zone. */
export function freeTermEndsAt(endsOn: CalendarDate, timeZone: string): Date {
  const nextDay = parseWallTime(shiftCalendarDate(endsOn, 1), "00:00");
  // `parseWallTime` only refuses a malformed date; a stored `date` column is
  // never one, so this is the shape guard rather than a real branch.
  if (!nextDay) throw new Error(`invalid free-term date: ${endsOn}`);
  return wallTimeToUtc(nextDay, timeZone);
}

/** True while `freeTermEndsOn` still covers today in the shop's zone. */
function inFreeTerm(input: BillingStandingInput): boolean {
  if (!input.freeTermEndsOn) return false;
  return calendarDateInTimezone(input.now, input.timeZone) <= input.freeTermEndsOn;
}

/**
 * When the shop's free time ends — whichever of the trial and the free term
 * runs later — or null if both are behind it. This is also the first charge
 * date Checkout asks Stripe for, so a shop that adds a card on day three is
 * not charged on day three.
 */
export function freeTimeEndsAt(
  input: Pick<BillingStandingInput, "now" | "timeZone" | "trialEndsAt" | "freeTermEndsOn">,
): Date | null {
  const candidates = [input.trialEndsAt];
  if (input.freeTermEndsOn) candidates.push(freeTermEndsAt(input.freeTermEndsOn, input.timeZone));
  const latest = candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  return latest.getTime() > input.now.getTime() ? latest : null;
}

/** Which free window the shop is in when nothing Stripe says outranks it. */
function freeStatus(input: BillingStandingInput): "free_term" | "trialing" | null {
  if (inFreeTerm(input)) return "free_term";
  if (input.now.getTime() < input.trialEndsAt.getTime()) return "trialing";
  return null;
}

export function billingStanding(input: BillingStandingInput): BillingStanding {
  const freeUntil = freeTimeEndsAt(input);
  const subscription = input.subscription;
  const scheduled = (status: BillingStatus): BillingStanding => {
    const periodEnd = subscription?.currentPeriodEnd ?? null;
    const ending = subscription?.cancelAtPeriodEnd === true;
    return {
      status,
      hasSubscription: true,
      nextChargeAt: ending ? null : periodEnd,
      endsAt: ending ? periodEnd : null,
      freeUntil,
    };
  };
  const unsubscribed = (status: BillingStatus): BillingStanding => ({
    status,
    hasSubscription: false,
    nextChargeAt: null,
    endsAt: null,
    freeUntil,
  });

  if (subscription) {
    switch (subscription.status) {
      case "active":
        return scheduled("active");
      // A Stripe-side trial is the free time Checkout deferred the first
      // charge to: the shop is still on its trial or free term, card on file.
      case "trialing":
        return scheduled(freeStatus(input) ?? "trialing");
      case "past_due":
      case "unpaid":
      case "paused":
        return scheduled("past_due");
      case "canceled":
      case "incomplete_expired":
        return {
          status: "canceled",
          hasSubscription: false,
          nextChargeAt: null,
          endsAt: null,
          freeUntil,
        };
      // Checkout opened a subscription whose first payment has not settled.
      // Nothing is promised yet, so the free windows still decide.
      case "incomplete":
        break;
    }
  }
  return unsubscribed(freeStatus(input) ?? "trial_ended");
}

/**
 * **The seam.** True while the shop owes DiveDay nothing it has not paid:
 * inside its trial or free term, or paying with the last charge collected.
 *
 * Read by nothing that gates today — see the module docblock.
 */
export function isInGoodStanding(status: BillingStatus): boolean {
  return status === "trialing" || status === "free_term" || status === "active";
}
