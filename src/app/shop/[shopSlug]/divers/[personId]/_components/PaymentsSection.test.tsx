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
      paymentsConnected
    />,
  );
}

/** `count` bookings, newest first by `trip.startsAt`, one day apart — no payments or orders attached. */
function diverWithBookings(count: number): DiverProfile {
  return {
    bookings: Array.from({ length: count }, (_, index) => ({
      booking: { id: `booking-${index}`, status: "checked_in" },
      trip: {
        id: `trip-${index}`,
        title: `Trip ${index}`,
        startsAt: new Date(2026, 0, count - index),
        endsAt: new Date(2026, 0, count - index),
      },
      course: null,
    })),
    bookingPayments: [],
    orders: [],
  } as unknown as DiverProfile;
}

function renderBookings(count: number, paymentsConnected = true) {
  return render(
    <PaymentsSection
      diver={diverWithBookings(count)}
      shop={shop}
      locale="en-US"
      shopSlug="reef-shop"
      personId="person-1"
      canRefund={false}
      paymentsConnected={paymentsConnected}
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

describe("PaymentsSection history length", () => {
  it("renders every row with no disclosure when at or under the preview count", () => {
    renderBookings(8);
    expect(screen.getByText("Trip 0")).toBeInTheDocument();
    expect(screen.getByText("Trip 7")).toBeInTheDocument();
    expect(screen.queryByText(/Show \d+ older payment/)).not.toBeInTheDocument();
  });

  it("previews the newest rows and tucks the rest behind a disclosure", () => {
    // A long-tenured diver's full booking history otherwise renders one row
    // per trip they've ever taken, with no ceiling (same class of bug the
    // shop-wide orders index had before it was paginated).
    renderBookings(10);
    expect(screen.getByText("Show 2 older payments")).toBeInTheDocument();
    // The newest 8 (by trip.startsAt) are the immediate list...
    for (let i = 0; i < 8; i++) {
      expect(screen.getByText(`Trip ${i}`)).toBeInTheDocument();
    }
    // ...and the two oldest are still reachable, not dropped, inside the
    // disclosure the same way `ShopHistory`'s "older entries" panel works.
    expect(screen.getByText("Trip 8")).toBeInTheDocument();
    expect(screen.getByText("Trip 9")).toBeInTheDocument();
  });
});

/**
 * `orders/new` refuses to open at all until the shop can accept payments, so a
 * day-one shop's "New payment"/"Create invoice" buttons went nowhere and said
 * nothing. Hiding them is a courtesy — the page still re-checks — but the
 * courtesy is what stops a button from reading as broken.
 */
describe("PaymentsSection with no connected payment account", () => {
  it("offers to connect payments instead of linking at the invoice door", () => {
    renderBookings(1, false);

    const connect = screen.getAllByRole("link", { name: "Connect payments" });
    // Both entry points: the section's own header button and the per-booking
    // row's "Create invoice".
    expect(connect.length).toBeGreaterThanOrEqual(2);
    for (const link of connect) {
      expect(link).toHaveAttribute("href", "/shop/reef-shop/settings#money");
    }
    expect(screen.queryByRole("link", { name: "New payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create invoice" })).not.toBeInTheDocument();
  });

  it("keeps the invoice buttons when payments are connected", () => {
    renderBookings(1, true);

    expect(screen.getByRole("link", { name: "New payment" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/new?personId=person-1",
    );
    expect(screen.getByRole("link", { name: "Create invoice" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect payments" })).not.toBeInTheDocument();
  });
});
