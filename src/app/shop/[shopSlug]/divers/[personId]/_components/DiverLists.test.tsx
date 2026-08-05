// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopHistory } from "./ShopHistory";
import type { DiverProfile, Shop } from "./shared";
import { UpcomingTripsSection } from "./UpcomingTripsSection";

vi.mock("../actions", () => ({ refundPaymentAction: vi.fn() }));

const shop = { id: "shop-1", timezone: "America/Cancun", isDemo: false } as unknown as Shop;
const NOW = new Date("2026-07-18T12:00:00.000Z");

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

const AHEAD = booking("b-ahead", "Saturday reef charter", new Date("2026-07-25T13:00:00.000Z"));
const BEHIND = booking("b-behind", "Last month's wreck dive", new Date("2026-06-10T13:00:00.000Z"));

function diver(bookings: unknown[]): DiverProfile {
  return {
    bookings,
    orders: [],
    bookingPayments: [],
    priorVisits: [],
  } as unknown as DiverProfile;
}

const common = {
  shop,
  locale: "en-US",
  shopSlug: "reef-shop",
  personId: "person-1",
  paymentsConnected: true,
  now: NOW,
};

afterEach(cleanup);

/**
 * The bug this pins: the diver record showed the same booking in Upcoming, in
 * Payments (a row per booking), and again in the full history — three tellings
 * of one Saturday charter on one page. Payments now lists orders only; these
 * two lists split the bookings between them on one axis, ahead or behind, and
 * a booking must land in exactly one.
 */
describe("a booking appears in exactly one list", () => {
  it("puts a future departure in Upcoming and keeps it out of the history", () => {
    render(<UpcomingTripsSection diver={diver([AHEAD, BEHIND])} {...common} />);
    expect(screen.getByText("Saturday reef charter")).toBeInTheDocument();
    expect(screen.queryByText("Last month's wreck dive")).not.toBeInTheDocument();
    cleanup();

    render(<ShopHistory diver={diver([AHEAD, BEHIND])} {...common} />);
    expect(screen.getByText("Last month's wreck dive")).toBeInTheDocument();
    expect(screen.queryByText("Saturday reef charter")).not.toBeInTheDocument();
  });

  it("files a cancelled future booking as history, not as something still ahead", () => {
    // The seat is not coming back, so it is behind the diver whatever the
    // calendar says — and dropping it from both lists would erase a real record.
    const cancelled = booking("b-x", "Cancelled charter", new Date("2026-07-25T13:00:00.000Z"), {
      bookingStatus: "cancelled",
    });
    render(<UpcomingTripsSection diver={diver([cancelled])} {...common} />);
    expect(screen.queryByText("Cancelled charter")).not.toBeInTheDocument();
    cleanup();

    render(<ShopHistory diver={diver([cancelled])} {...common} />);
    expect(screen.getByText("Cancelled charter")).toBeInTheDocument();
  });

  it("files a future booking on a cancelled trip the same way", () => {
    const offTrip = booking("b-y", "Blown-out charter", new Date("2026-07-25T13:00:00.000Z"), {
      tripStatus: "cancelled",
    });
    render(<UpcomingTripsSection diver={diver([offTrip])} {...common} />);
    expect(screen.queryByText("Blown-out charter")).not.toBeInTheDocument();
    cleanup();

    render(<ShopHistory diver={diver([offTrip])} {...common} />);
    expect(screen.getByText("Blown-out charter")).toBeInTheDocument();
  });

  it("shows each list's rows with their money state, so neither hides what is owed", () => {
    render(<UpcomingTripsSection diver={diver([AHEAD])} {...common} />);
    expect(screen.getByRole("link", { name: "Create order" })).toBeInTheDocument();
  });
});
