// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { BookingGearFields } from "./BookingGearFields";

const pricing: RentalPricing = {
  setCents: 4500,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1200,
    mask_fins: 800,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1200,
};

const rentalItems = [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
  "nitrox",
];

afterEach(cleanup);

describe("BookingGearFields", () => {
  it("checks the shop's default items and leaves the GoPro and nitrox off", () => {
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(screen.getByLabelText(/^Weights/)).toBeChecked();
    expect(screen.getByLabelText(/^BCD/)).toBeChecked();
    expect(screen.getByLabelText(/^GoPro/)).not.toBeChecked();
    expect(screen.getByLabelText(/Reserve nitrox-compatible tanks/)).not.toBeChecked();
  });

  it("uses the diver-N heading once shown for more than one party member", () => {
    renderDiver(
      <BookingGearFields
        index={1}
        showDiverLabel
        rentalItems={rentalItems}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(screen.getByText("Diver 2's gear")).toBeInTheDocument();
    expect(screen.queryByText("Rental gear")).not.toBeInTheDocument();
  });

  it("field names carry the party index, so bookSpot can parse each diver separately", () => {
    const { container } = renderDiver(
      <BookingGearFields
        index={2}
        showDiverLabel
        rentalItems={rentalItems}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(container.querySelector('input[name="gear-2-bcd"]')).not.toBeNull();
    expect(container.querySelector('input[name="gear-2-gopro"]')).not.toBeNull();
    expect(container.querySelector('input[name="nitrox-2"]')).not.toBeNull();
  });

  it("reacts to unchecking a core item and checking nitrox, and reports the new subtotal", () => {
    const onSubtotalChange = vi.fn();
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
        onSubtotalChange={onSubtotalChange}
      />,
    );

    // Every core item offered is checked by default, so the set price (the
    // cheaper bundle) applies — $45.00.
    expect(screen.getByText("Gear for this diver: $45.00")).toBeInTheDocument();
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 4_500);

    // Dropping one core item still quotes the $45 set price: the remaining
    // five pieces priced individually (bcd+regulator+wetsuit+mask_fins+
    // dive_computer = 1500+1500+1200+800+1000 = 6000) cost more than the set,
    // so skipping a piece is never charged more than the full set (H-06, HD-9).
    fireEvent.click(screen.getByLabelText(/^Weights/));
    expect(screen.getByText("Gear for this diver: $45.00")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Reserve nitrox-compatible tanks/));
    // Nitrox is $12/dive × 2 planned dives = $24, added on top of the $45 set.
    expect(screen.getByText("Gear for this diver: $69.00")).toBeInTheDocument();
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 6_900);
  });

  it("renders nothing when the shop has priced no rental gear online", () => {
    const { container } = renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        pricing={{ setCents: null, perItemCents: {}, nitroxCents: null }}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
