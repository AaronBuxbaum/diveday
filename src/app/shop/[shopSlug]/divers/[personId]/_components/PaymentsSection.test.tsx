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
          createdAt: new Date(2026, 0, 4),
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

/** `count` orders, newest first by `createdAt`, one day apart. */
function diverWithOrders(count: number): DiverProfile {
  return {
    bookings: [],
    bookingPayments: [],
    orders: Array.from({ length: count }, (_, index) => ({
      order: {
        id: `order-${index}`,
        bookingId: null,
        description: `Payment ${index}`,
        status: "paid",
        totalCents: 1000,
        currency: "usd",
        createdAt: new Date(2026, 0, count - index),
      },
    })),
  } as unknown as DiverProfile;
}

function renderOrders(count: number, paymentsConnected = true) {
  return render(
    <PaymentsSection
      diver={diverWithOrders(count)}
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

describe("an order says what it billed for", () => {
  it("names the trip, not the order's own description", () => {
    // A shop that words every invoice the same way ("Two-tank charter") would
    // otherwise get a column of identical rows telling three different
    // charters apart only by amount and date.
    render(
      <PaymentsSection
        diver={
          {
            bookings: [
              {
                booking: { id: "booking-1", status: "booked" },
                trip: { id: "trip-1", title: "Two-Tank Reef — Benwood" },
                course: null,
              },
            ],
            bookingPayments: [],
            orders: [
              {
                order: {
                  id: "order-1",
                  bookingId: "booking-1",
                  description: "Two-tank charter",
                  status: "paid",
                  totalCents: 13_000,
                  currency: "usd",
                  createdAt: new Date(2026, 2, 22),
                },
              },
            ],
          } as unknown as DiverProfile
        }
        shop={shop}
        locale="en-US"
        shopSlug="reef-shop"
        personId="person-1"
        canRefund={false}
        paymentsConnected
      />,
    );
    expect(screen.getByRole("link", { name: "Two-Tank Reef — Benwood" })).toBeInTheDocument();
  });

  it("falls back to the description for a payment with no booking behind it", () => {
    renderSection(13_000, "usd");
    expect(screen.getByRole("link", { name: "Nitrox course top-up" })).toBeInTheDocument();
  });
});

/**
 * This section lists **orders**, not bookings. It used to render a row per
 * booking — every trip the diver had ever been on, whether or not money was
 * involved — which made it the third list of the same bookings on one page,
 * after Upcoming and the history below.
 */
describe("PaymentsSection lists money, not bookings", () => {
  it("does not repeat a booking that has no order against it", () => {
    render(
      <PaymentsSection
        diver={
          {
            bookings: [
              {
                booking: { id: "booking-1", status: "checked_in" },
                trip: {
                  id: "trip-1",
                  title: "Saturday reef charter",
                  startsAt: new Date(2026, 0, 4),
                  endsAt: new Date(2026, 0, 4),
                },
                course: null,
              },
            ],
            bookingPayments: [],
            orders: [],
          } as unknown as DiverProfile
        }
        shop={shop}
        locale="en-US"
        shopSlug="reef-shop"
        personId="person-1"
        canRefund={false}
        paymentsConnected
      />,
    );
    expect(screen.queryByText("Saturday reef charter")).not.toBeInTheDocument();
    expect(screen.getByText(/No payments yet/)).toBeInTheDocument();
  });

  it("renders every order with no disclosure when at or under the preview count", () => {
    renderOrders(8);
    expect(screen.getByText("Payment 0")).toBeInTheDocument();
    expect(screen.getByText("Payment 7")).toBeInTheDocument();
    expect(screen.queryByText(/Show \d+ older payment/)).not.toBeInTheDocument();
  });

  it("previews the newest orders and tucks the rest behind a disclosure", () => {
    // A long-tenured diver's full payment history otherwise renders with no
    // ceiling (same class of bug the shop-wide orders index had before it was
    // paginated).
    renderOrders(10);
    expect(screen.getByText("Show 2 older payments")).toBeInTheDocument();
    for (let i = 0; i < 8; i++) {
      expect(screen.getByText(`Payment ${i}`)).toBeInTheDocument();
    }
    // The two oldest are still reachable, not dropped, inside the disclosure
    // the same way `ShopHistory`'s "older entries" panel works.
    expect(screen.getByText("Payment 8")).toBeInTheDocument();
    expect(screen.getByText("Payment 9")).toBeInTheDocument();
  });
});

/**
 * `orders/new` refuses to open at all until the shop can accept payments, so a
 * day-one shop's "New payment" button went nowhere and said nothing. Hiding it
 * is a courtesy — the page still re-checks — but the courtesy is what stops a
 * button from reading as broken.
 */
describe("PaymentsSection with no connected payment account", () => {
  it("offers to connect payments instead of linking at the order door", () => {
    renderOrders(1, false);

    expect(screen.getByRole("link", { name: "Connect payments" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/settings#money",
    );
    expect(screen.queryByRole("link", { name: "New payment" })).not.toBeInTheDocument();
  });

  it("keeps the order button when payments are connected", () => {
    renderOrders(1, true);

    expect(screen.getByRole("link", { name: "New payment" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/new?personId=person-1",
    );
    expect(screen.queryByRole("link", { name: "Connect payments" })).not.toBeInTheDocument();
  });
});
