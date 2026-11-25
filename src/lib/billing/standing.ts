import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

/**
 * Where a shop stands with DiveDay's own subscription — the one answer to "is
 * this shop paid up?" (ADR 20261007-subscription-billing).
 *
 * Pure on purpose. Every input is a fact somebody else recorded: the free term
 * DiveDay granted by hand (`shop_subscriptions.free_term_ends_on`) and the last
 * subscription state Stripe's webhook told us. Nothing here reads a clock or a table, so the
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
 * What the Billing page says, as a code (the page picks the words). A shop is
 * free with no card (ADR 20261124-free-shops-no-trial): having no card is an
 * ordinary state, never a lapse.
 *
 * - `no_card` — no subscription Stripe will charge, and no free term running.
 * - `free_term` — inside a free term DiveDay granted by hand, card or not.
 * - `active` — a card is on file and the last charge, if any, went through.
 * - `past_due` — Stripe could not collect the last charge.
 * - `canceled` — the subscription ended.
 */
export type BillingStatus = "no_card" | "free_term" | "active" | "past_due" | "canceled";

export type SubscriptionSnapshot = {
  status: StripeSubscriptionStatus;
  /** When the current period ends: the next charge, or the first one after a free term. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingStandingInput = {
  now: Date;
  /** The shop's own zone: a free term ends at the end of its last day *there*. */
  timeZone: string;
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
  /** When the free term ends; null when there is none or it already has. */
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
 * When the shop's free term ends, or null if it has none or it is behind it.
 * This is also the first charge date Checkout asks Stripe for, so a shop that
 * adds a card during its free term is not charged until the term is over.
 */
export function freeTimeEndsAt(
  input: Pick<BillingStandingInput, "now" | "timeZone" | "freeTermEndsOn">,
): Date | null {
  const end = freePeriodEndsAt(input);
  return end && end.getTime() > input.now.getTime() ? end : null;
}

/**
 * The cutoff before which collected money is never billed: the end of a
 * granted free term, retained after it passes; null (bill from the start)
 * when none was granted.
 */
export function freePeriodEndsAt(
  input: Pick<BillingStandingInput, "timeZone" | "freeTermEndsOn">,
): Date | null {
  return input.freeTermEndsOn ? freeTermEndsAt(input.freeTermEndsOn, input.timeZone) : null;
}

/**
 * The instant from which collected money is billed: the later of a granted
 * free term's end and the card-added instant (`subscribedAt`). With no
 * subscription yet it is `now`, so nothing collected card-less is ever billed,
 * including the months before a card is added (ADR 20261124-free-shops-no-trial).
 */
export function billableFrom(
  input: Pick<BillingStandingInput, "now" | "timeZone" | "freeTermEndsOn"> & {
    subscribedAt: Date | null;
  },
): Date {
  // mutation-ok: subscribedAt is a Date or null, so ?? and || pick the same side
  const card = input.subscribedAt ?? input.now;
  const free = freePeriodEndsAt(input);
  // mutation-ok: at equal instants free and card are the same moment, so > and >= agree
  return free && free.getTime() > card.getTime() ? free : card;
}

export function billingStanding(input: BillingStandingInput): BillingStanding {
  const freeUntil = freeTimeEndsAt(input);
  const subscription = input.subscription;
  const free = inFreeTerm(input);
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

  if (subscription) {
    switch (subscription.status) {
      case "active":
        return scheduled("active");
      // A Stripe-side trial is the free term Checkout deferred the first
      // charge to: card on file, first charge scheduled.
      case "trialing":
        return scheduled(free ? "free_term" : "active");
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
      // Nothing is promised yet, so the shop reads as it did before.
      case "incomplete":
        break;
    }
  }
  return {
    status: free ? "free_term" : "no_card",
    hasSubscription: false,
    nextChargeAt: null,
    endsAt: null,
    freeUntil,
  };
}

/**
 * **The seam.** True while the shop owes DiveDay nothing it has not paid:
 * every state except a failed charge or an ended subscription.
 *
 * Read by nothing that gates today — see the module docblock.
 */
export function isInGoodStanding(status: BillingStatus): boolean {
  return status === "no_card" || status === "free_term" || status === "active";
}
