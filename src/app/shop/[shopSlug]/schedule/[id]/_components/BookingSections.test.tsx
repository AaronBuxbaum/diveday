// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookSpotSection } from "./BookingSections";
import type { Trip } from "./types";

/**
 * The per-diver price on the booking form is a list price, so it follows
 * `shops.currency` — Ingrid booking a Cozumel dive is quoted pesos, not
 * dollars (task 35, docs ADR 20260731-shop-currency).
 */
function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    shopId: "shop-1",
    title: "Palancar Reef Two-Tank",
    description: null,
    capacity: 8,
    booked: 2,
    plannedDives: 2,
    course: null,
    conditionsHold: false,
    ...overrides,
  } as Trip;
}

const tripRef = { shopSlug: "reef-shop", tripId: "trip-1", embed: false };

afterEach(cleanup);

describe("BookSpotSection price currency (task 35)", () => {
  it("quotes the per-diver price in the shop's currency, not dollars", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={130_000}
        currency="mxn"
        locale="en-US"
      />,
    );

    expect(screen.getByText(/MX\$1,300\.00 per diver/)).toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // JPY stores whole yen: a ¥13,000 dive is `13000`, and a literal `/ 100`
    // would offer the seat at ¥130.
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={13_000}
        currency="jpy"
        locale="en-US"
      />,
    );

    expect(screen.getByText(/¥13,000 per diver/)).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={13_000}
        currency="usd"
        locale="en-US"
      />,
    );

    expect(screen.getByText(/\$130\.00 per diver/)).toBeInTheDocument();
  });
});
