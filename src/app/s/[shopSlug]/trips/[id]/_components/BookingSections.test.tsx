// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_RENTAL_PRICING, type RentalPricing } from "@/lib/rentals";
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
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
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
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
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
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.getByText(/\$130\.00 per diver/)).toBeInTheDocument();
  });
});

// Diver-selectable checkout upsells (docs ADR 20260801-checkout-upsells-rental-gear).
const pricedRentals: RentalPricing = {
  setCents: 4500,
  perItemCents: { bcd: 1500, regulator: 1500, wetsuit: 1200, mask_fins: 800, weights: 500 },
  nitroxCents: null,
};

describe("BookSpotSection rental gear at checkout", () => {
  it("shows a gear step per diver when the shop prices rental gear and checkout is on", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={12_000}
        currency="usd"
        locale="en-US"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={pricedRentals}
      />,
    );

    expect(screen.getByText("Rental gear")).toBeInTheDocument();
    // Nothing is added until the diver asks for gear, so the running total
    // stays out of the way rather than announcing a charge nobody chose.
    expect(screen.queryByText(/Total due at checkout, gear included/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Need rental gear?"));
    fireEvent.click(screen.getByLabelText(/^BCD/));
    // $120 seat + $15 BCD.
    expect(screen.getByText(/Total due at checkout, gear included: \$135\.00/)).toBeInTheDocument();
  });

  it("shows no gear step when the shop hasn't priced any rental gear online", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={12_000}
        currency="usd"
        locale="en-US"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.queryByText("Rental gear")).not.toBeInTheDocument();
    expect(screen.queryByText(/Total due at checkout/)).not.toBeInTheDocument();
  });

  it("shows no gear step when checkout itself is off, even with rental pricing configured", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking={false}
        perDiverPriceCents={null}
        currency="usd"
        locale="en-US"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={pricedRentals}
      />,
    );

    expect(screen.queryByText("Rental gear")).not.toBeInTheDocument();
  });
});
