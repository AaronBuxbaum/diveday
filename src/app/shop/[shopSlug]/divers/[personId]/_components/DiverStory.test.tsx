// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DiverStory } from "./DiverStory";
import type { DiverProfile, Shop } from "./shared";

vi.mock("../actions", () => ({}));

afterEach(cleanup);

const t = staffTranslator("en-US");
const shop = { id: "shop-1", timezone: "America/Cancun", isDemo: false } as unknown as Shop;
const NOW = new Date("2026-07-18T12:00:00.000Z");
const AHEAD_AT = new Date("2026-07-25T13:00:00.000Z");
const BEHIND_AT = new Date("2026-06-10T13:00:00.000Z");

function booking(
  id: string,
  title: string,
  startsAt: Date,
  overrides: { bookingStatus?: string; tripStatus?: string } = {},
) {
  return {
    booking: { id, status: overrides.bookingStatus ?? "confirmed" },
    trip: {
      id: `trip-${id}`,
      title,
      startsAt,
      endsAt: startsAt,
      status: overrides.tripStatus ?? "scheduled",
    },
    course: null,
  };
}

const AHEAD = booking("b-ahead", "Saturday reef charter", AHEAD_AT);
const BEHIND = booking("b-behind", "Last month's wreck dive", BEHIND_AT);

function diver(overrides: Partial<Record<string, unknown>> = {}): DiverProfile {
  return {
    person: { id: "person-1", fullName: "Grace Mensah", deletedAt: null },
    waiver: { state: "current" },
    bookings: [],
    orders: [],
    bookingPayments: [],
    priorVisits: [],
    ...overrides,
  } as unknown as DiverProfile;
}

function renderStory(profile: DiverProfile, paymentsConnected = true) {
  return render(
    <DiverStory
      diver={profile}
      shop={shop}
      shopSlug="reef-shop"
      personId="person-1"
      locale="en-US"
      t={t}
      paymentsConnected={paymentsConnected}
      now={NOW}
    />,
  );
}

/**
 * The three lists this replaced told one story three times — Upcoming, a row
 * per booking in Payments, and the whole history again below. A seat now
 * appears exactly once, in date order.
 */
describe("one seat, one row", () => {
  it("puts a departure still ahead above one already behind, in one list", () => {
    renderStory(diver({ bookings: [BEHIND, AHEAD] }));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Saturday reef charter");
    expect(rows[1]?.textContent).toContain("Last month's wreck dive");
  });

  it("files a cancelled future booking behind the diver — the seat is not coming back", () => {
    const cancelled = booking("b-x", "Cancelled charter", AHEAD_AT, { bookingStatus: "cancelled" });
    renderStory(diver({ bookings: [cancelled, AHEAD] }));
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Saturday reef charter");
    expect(rows[1]?.textContent).toContain("Cancelled charter");
  });

  it("files a future booking on a blown-out departure the same way", () => {
    const offTrip = booking("b-y", "Blown-out charter", AHEAD_AT, { tripStatus: "cancelled" });
    renderStory(diver({ bookings: [offTrip, AHEAD] }));
    expect(screen.getAllByRole("listitem")[1]?.textContent).toContain("Blown-out charter");
  });

  it("opens the manifest while a departure is ahead, and the trip once it is behind", () => {
    renderStory(diver({ bookings: [AHEAD, BEHIND] }));
    expect(screen.getByRole("link", { name: "Saturday reef charter" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/trips/trip-b-ahead/manifest",
    );
    expect(screen.getByRole("link", { name: "Last month's wreck dive" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/trips/trip-b-behind",
    );
  });
});

describe("money is a fact of the row", () => {
  it("says what one seat's invoice stands at, with its amount", () => {
    renderStory(
      diver({
        bookings: [AHEAD],
        orders: [
          {
            order: {
              id: "order-1",
              bookingId: "b-ahead",
              status: "open",
              totalCents: 9500,
              currency: "usd",
              createdAt: AHEAD_AT,
            },
          },
        ],
      }),
    );
    expect(screen.getByText("Open · $95.00")).toBeInTheDocument();
  });

  /**
   * An absence is not a fact worth a pill: a shop that settles at the counter
   * would otherwise carry a grey "No order" mark down every row it ever ran.
   */
  it("says nothing at all about a seat nobody has billed", () => {
    const { container } = renderStory(diver({ bookings: [AHEAD] }));
    expect(container.textContent).not.toContain("No order");
    expect(within(screen.getByRole("listitem")).queryByText(/\$/)).toBeNull();
  });

  it("gives a person-level payment its own row, pointing at the order", () => {
    renderStory(
      diver({
        orders: [
          {
            order: {
              id: "order-2",
              bookingId: null,
              status: "paid",
              description: "Gear rental",
              totalCents: 4000,
              currency: "usd",
              createdAt: BEHIND_AT,
            },
          },
        ],
      }),
    );
    expect(screen.getByRole("link", { name: "Gear rental" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/order-2",
    );
  });
});

describe("what came across from the old system", () => {
  /**
   * An imported row is a booking record the previous system held — evidence a
   * seat was reserved, not evidence anybody got in the water (ADR
   * 20260725-import-prior-visits). It is marked, and it is never a door.
   */
  it("marks an imported visit and gives it nothing to open", () => {
    renderStory(
      diver({
        priorVisits: [
          {
            id: "v1",
            visitedOn: "2026-03-03",
            title: "Reef morning — two tanks",
            sourceLabel: "Old system",
            amountLabel: "$80",
            statusLabel: "completed",
          },
        ],
      }),
    );
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("Imported");
    expect(within(row).queryByRole("link")).toBeNull();
  });
});

describe("the story's bounds and its foot", () => {
  it("says so plainly when a diver has been nowhere yet", () => {
    renderStory(diver());
    expect(screen.getByText("No visits yet.")).toBeInTheDocument();
  });

  it("folds everything past the tenth entry behind one disclosure", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      booking(`old-${index}`, `Charter ${index}`, new Date(2026, 0, index + 1)),
    );
    renderStory(diver({ bookings: many }));
    expect(screen.getByText("Show all 12")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });

  /**
   * `orders/new` refuses outright without a payable Stripe account, so the act
   * is simply absent rather than a link that bounces — and connecting payments
   * left the person page with the ADR.
   */
  it("offers the invoice door only when the shop can take money", () => {
    renderStory(diver({ bookings: [AHEAD] }), false);
    expect(screen.queryByRole("link", { name: "+ New invoice" })).toBeNull();
    cleanup();
    renderStory(diver({ bookings: [AHEAD] }), true);
    expect(screen.getByRole("link", { name: "+ New invoice" })).toHaveAttribute(
      "href",
      "/shop/reef-shop/orders/new?personId=person-1",
    );
  });
});
