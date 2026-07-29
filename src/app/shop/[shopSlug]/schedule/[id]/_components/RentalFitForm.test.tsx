// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import type { RentalPricing } from "@/lib/rentals";
import { RentalFitForm } from "./RentalFitForm";

const emptyFit: DiverRentalFit = {
  rentsBcd: false,
  bcdSize: null,
  rentsRegulator: false,
  rentsWetsuit: false,
  wetsuitSize: null,
  bootSize: null,
  rentsMaskFins: false,
  finSize: null,
  rentsWeights: false,
  weightPreference: null,
  rentsDiveComputer: false,
  rentsGopro: false,
  note: null,
};

const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1500,
    mask_fins: 1000,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1000,
};

const mockAction = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RentalFitForm Gear-Status Light-up Indicator", () => {
  it("renders 'Bringing own gear' by default if no rentals selected", () => {
    render(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Bringing own gear — no rental needed.");
  });

  it("renders 'Select sizes' when rentals are selected but size is missing", () => {
    const fitWithRentals = { ...emptyFit, rentsBcd: true };
    render(
      <RentalFitForm
        action={mockAction}
        rentalFit={fitWithRentals}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");
  });

  it("renders 'Gear matched and pre-packed' when all sizes are confirmed", () => {
    const confirmedFit = { ...emptyFit, rentsBcd: true, bcdSize: "M" };
    render(
      <RentalFitForm
        action={mockAction}
        rentalFit={confirmedFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });

  it("updates dynamically when user checks a rental and inputs a size", () => {
    const { container } = render(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Bringing own gear — no rental needed.");

    // Check BCD rental checkbox by selecting specifically input[type="checkbox"] label
    const bcdCheckbox = screen.getByLabelText(/bcd/i, {
      selector: 'input[type="checkbox"]',
    }) as HTMLInputElement;
    fireEvent.click(bcdCheckbox);

    // Indicator should now tell the user to select sizes
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select BCD size
    const bcdSelect = container.querySelector('select[name="bcdSize"]') as HTMLSelectElement;
    fireEvent.change(bcdSelect, { target: { value: "L" } });

    // Indicator should now light up
    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });
});
