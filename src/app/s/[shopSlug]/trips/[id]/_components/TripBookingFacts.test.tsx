// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripBookingFacts } from "./TripBookingFacts";
import type { Shop, Trip } from "./types";

afterEach(cleanup);
const shop = {
  name: "Reef Divers",
  timezone: "America/New_York",
  currency: "usd",
  packingList: ["Towel"],
  briefingMinutes: 15,
  rentalItems: ["bcd", "regulator", "wetsuit", "mask", "fins", "weights"],
  rentalPricing: {
    setCents: 4500,
    perItemCents: { bcd: 1500, regulator: 1500, wetsuit: 1000, mask: 500, fins: 500, weights: 500 },
    nitroxCents: null,
  },
  addressStreet: "12 Shop Street",
  addressLocality: null,
  addressRegion: null,
  addressPostalCode: null,
  addressCountry: null,
} as unknown as Shop;
const trip = {
  startsAt: new Date("2026-11-20T14:00:00Z"),
  course: null,
  meetingPointLabel: "North dock",
  meetingPointAddress: "34 Marina Road",
  cancellationWindowHours: 24,
} as Trip;
function show(s: Shop = shop, t: Trip = trip) {
  return render(<TripBookingFacts shop={s} trip={t} locale="en-US" />);
}
describe("TripBookingFacts", () => {
  it("shows packing, quoted rentals, meeting address and stated cancellation before booking", () => {
    show();
    expect(screen.getByRole("heading", { name: "Good to know" })).toBeInTheDocument();
    expect(screen.getByText("Towel")).toBeInTheDocument();
    expect(screen.getByText(/Rental gear from \$5.00/)).toBeInTheDocument();
    expect(screen.getByText(/Full set \$45.00/)).toBeInTheDocument();
    expect(screen.getByText("North dock")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "34 Marina Road" })).toHaveAttribute(
      "href",
      expect.stringContaining("34%20Marina%20Road"),
    );
    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing requested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tanks and weights/)).not.toBeInTheDocument();
    expect(screen.queryByText("12 Shop Street")).not.toBeInTheDocument();
  });
  it("states course inclusions without selling the included set again", () => {
    show(shop, { ...trip, course: { includedRentalKinds: shop.rentalItems } } as Trip);
    expect(screen.getByText("Scuba unit (BCD, regulator, tank, weights)")).toBeInTheDocument();
    expect(screen.getByText("Mask")).toBeInTheDocument();
    expect(screen.queryByText(/Rental gear from/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Full set/)).not.toBeInTheDocument();
  });
  it("does not invent rental prices or cancellation terms the shop has not set", () => {
    show(
      { ...shop, rentalPricing: { setCents: null, perItemCents: {}, nitroxCents: null } },
      { ...trip, cancellationWindowHours: null },
    );
    expect(screen.getByText("Towel")).toBeInTheDocument();
    expect(
      screen.queryByText(/Rental gear from|Full set|Free cancellation/),
    ).not.toBeInTheDocument();
  });
  it("does not quote prices for gear outside the current catalog or an incomplete set", () => {
    show({
      ...shop,
      rentalPricing: { setCents: 4500, perItemCents: { bcd: 1500, gopro: 1 }, nitroxCents: null },
    });
    expect(screen.getByText(/Rental gear from \$15.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Full set/)).not.toBeInTheDocument();
  });
});
