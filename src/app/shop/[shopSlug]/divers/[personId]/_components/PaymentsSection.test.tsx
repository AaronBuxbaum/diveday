// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentsSection } from "./PaymentsSection";
import type { DiverProfile, Shop } from "./shared";

// The refund server action drags next-auth (and therefore the whole Next
// server runtime) in behind it; this suite is about what the section renders,
// so the action is stubbed rather than booted.
vi.mock("../actions", () => ({ refundPaymentAction: vi.fn() }));

/**
 * A shop payment not attached to a trip shows the amount in the currency
 * stored on that order row — evidence of what was charged, never today's shop
 * setting (task 35, docs ADR 20260731-shop-currency).
 */
const shop = { id: "shop-1", timezone: "America/Cancun", isDemo: false } as unknown as Shop;

function diverWithOrder(totalCents: number, currency: string): DiverProfile {
  return {
    bookings: [],
    bookingPayments: [],
    orders: [
      {
        order: {
          id: "order-1",
          bookingId: null,
          description: "Nitrox course top-up",
          status: "paid",
          totalCents,
          currency,
        },
      },
    ],
  } as unknown as DiverProfile;
}

function renderSection(totalCents: number, currency: string) {
  return render(
    <PaymentsSection
      diver={diverWithOrder(totalCents, currency)}
      shop={shop}
      locale="en-US"
      shopSlug="reef-shop"
      personId="person-1"
      canRefund={false}
    />,
  );
}

afterEach(cleanup);

describe("PaymentsSection order currency (task 35)", () => {
  it("shows a peso order in pesos, not dollars", () => {
    renderSection(130_000, "mxn");
    expect(screen.getByText(/MX\$1,300\.00/)).toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // ¥13,000 is stored as whole yen — a literal `/ 100` would show ¥130.
    renderSection(13_000, "jpy");
    expect(screen.getByText(/¥13,000/)).toBeInTheDocument();
  });

  it("still reads as dollars for a usd order", () => {
    renderSection(13_000, "usd");
    expect(screen.getByText(/\$130\.00/)).toBeInTheDocument();
  });
});
