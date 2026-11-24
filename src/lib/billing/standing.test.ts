import { describe, expect, it } from "vitest";
import {
  type BillingStandingInput,
  type BillingStatus,
  billingStanding,
  freePeriodEndsAt,
  freeTermEndsAt,
  freeTimeEndsAt,
  isInGoodStanding,
  STRIPE_SUBSCRIPTION_STATUSES,
  type StripeSubscriptionStatus,
} from "./standing";

const NOW = new Date("2026-10-07T15:00:00.000Z");
const PERIOD_END = new Date("2026-11-07T15:00:00.000Z");

function input(overrides: Partial<BillingStandingInput> = {}): BillingStandingInput {
  return {
    now: NOW,
    timeZone: "America/New_York",
    freeTermEndsOn: null,
    subscription: null,
    ...overrides,
  };
}

function withSubscription(
  status: StripeSubscriptionStatus,
  extra: Partial<BillingStandingInput> = {},
  cancelAtPeriodEnd = false,
): BillingStandingInput {
  return input({
    ...extra,
    subscription: { status, currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd },
  });
}

describe("billingStanding without a subscription", () => {
  it("is no_card from the day the shop is created, with nothing scheduled", () => {
    const standing = billingStanding(input());
    expect(standing).toEqual({
      status: "no_card",
      hasSubscription: false,
      nextChargeAt: null,
      endsAt: null,
      freeUntil: null,
    });
  });

  it("is on its free term while the granted date has not passed", () => {
    const standing = billingStanding(input({ freeTermEndsOn: "2027-04-01" }));
    expect(standing.status).toBe("free_term");
    expect(standing.freeUntil).toEqual(freeTermEndsAt("2027-04-01", "America/New_York"));
  });

  it("counts the free term's last day as free in the shop's own zone", () => {
    // 2026-10-08 03:00 UTC is still the evening of 2026-10-07 in New York.
    const lateEvening = new Date("2026-10-08T03:00:00.000Z");
    expect(billingStanding(input({ now: lateEvening, freeTermEndsOn: "2026-10-07" })).status).toBe(
      "free_term",
    );
    // Midnight in New York is 04:00 UTC in October.
    const nextMorning = new Date("2026-10-08T04:00:00.000Z");
    expect(billingStanding(input({ now: nextMorning, freeTermEndsOn: "2026-10-07" })).status).toBe(
      "no_card",
    );
  });

  it("is no_card again once a free term is behind it", () => {
    const standing = billingStanding(input({ freeTermEndsOn: "2026-09-01" }));
    expect(standing.status).toBe("no_card");
    expect(standing.freeUntil).toBeNull();
  });

  it("reads as before while Checkout's first payment is still incomplete", () => {
    expect(billingStanding(withSubscription("incomplete")).status).toBe("no_card");
    expect(
      billingStanding(withSubscription("incomplete", { freeTermEndsOn: "2027-01-01" })).status,
    ).toBe("free_term");
  });
});

describe("billingStanding with a subscription", () => {
  it("is active with the period end as the next charge", () => {
    const standing = billingStanding(withSubscription("active"));
    expect(standing).toMatchObject({
      status: "active",
      hasSubscription: true,
      nextChargeAt: PERIOD_END,
      endsAt: null,
    });
  });

  it("reads a Stripe-side trial as the free term it defers to, first charge scheduled", () => {
    const deferred = billingStanding(withSubscription("trialing"));
    expect(deferred).toMatchObject({ status: "active", nextChargeAt: PERIOD_END });
    const free = billingStanding(withSubscription("trialing", { freeTermEndsOn: "2027-04-01" }));
    expect(free).toMatchObject({ status: "free_term", hasSubscription: true });
  });

  it("states an end date instead of a next charge once cancel-at-period-end is set", () => {
    const standing = billingStanding(withSubscription("active", {}, true));
    expect(standing).toMatchObject({ status: "active", nextChargeAt: null, endsAt: PERIOD_END });
  });

  it.each(["past_due", "unpaid", "paused"] as const)("reads %s as past_due", (status) => {
    expect(billingStanding(withSubscription(status)).status).toBe("past_due");
  });

  it.each(["canceled", "incomplete_expired"] as const)(
    "reads %s as canceled with nothing scheduled",
    (status) => {
      const standing = billingStanding(withSubscription(status, { freeTermEndsOn: "2027-01-01" }));
      expect(standing).toMatchObject({
        status: "canceled",
        hasSubscription: false,
        nextChargeAt: null,
        endsAt: null,
      });
    },
  );

  it("answers every status Stripe can send", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(billingStanding(withSubscription(status)).status).toBeTruthy();
    }
  });
});

describe("freeTimeEndsAt", () => {
  it("is the free term's end while it runs", () => {
    expect(freeTimeEndsAt(input({ freeTermEndsOn: "2027-04-01" }))).toEqual(
      new Date("2027-04-02T04:00:00.000Z"),
    );
  });

  it("is null with no free term, or once it has passed", () => {
    expect(freeTimeEndsAt(input())).toBeNull();
    expect(freeTimeEndsAt(input({ freeTermEndsOn: "2026-09-01" }))).toBeNull();
  });
});

describe("freePeriodEndsAt", () => {
  it("retains the free term's cutoff after it passes, for receipt accounting", () => {
    expect(freePeriodEndsAt(input({ freeTermEndsOn: "2026-02-01" }))).toEqual(
      new Date("2026-02-02T05:00:00Z"),
    );
  });

  it("bills from the start when no free term was granted", () => {
    expect(freePeriodEndsAt(input())).toBeNull();
  });
});

describe("isInGoodStanding", () => {
  const expected: Record<BillingStatus, boolean> = {
    no_card: true,
    free_term: true,
    active: true,
    past_due: false,
    canceled: false,
  };
  it.each(Object.entries(expected))("%s → %s", (status, good) => {
    expect(isInGoodStanding(status as BillingStatus)).toBe(good);
  });
});
