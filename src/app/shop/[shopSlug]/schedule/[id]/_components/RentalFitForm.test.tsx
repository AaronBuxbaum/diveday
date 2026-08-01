// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
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
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Bringing own gear — no rental needed.");
  });

  it("renders 'Select sizes' when rentals are selected but size is missing", () => {
    const fitWithRentals = { ...emptyFit, rentsBcd: true };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={fitWithRentals}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");
  });

  it("renders 'Gear matched and pre-packed' when all sizes are confirmed", () => {
    const confirmedFit = { ...emptyFit, rentsBcd: true, bcdSize: "M" };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={confirmedFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });

  it("updates dynamically when user checks a rental and inputs a size", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
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

  it("renders 'Gear matched' for wetsuit once wetsuit size is provided", () => {
    const wetsuitFit = { ...emptyFit, rentsWetsuit: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={wetsuitFit}
        rentalItems={["wetsuit"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select wetsuit size
    const wetsuitSelect = container.querySelector(
      'select[name="wetsuitSize"]',
    ) as HTMLSelectElement;
    fireEvent.change(wetsuitSelect, { target: { value: "M" } });

    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });

  it("renders 'Gear matched' for mask/fins immediately because fin size is optional", () => {
    const finsFit = { ...emptyFit, rentsMaskFins: true };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={finsFit}
        rentalItems={["mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });

  it("confirms gear match when BCD size is provided even if optional fin size is empty", () => {
    const mixedFit = { ...emptyFit, rentsBcd: true, rentsMaskFins: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={mixedFit}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select BCD size
    const bcdSelect = container.querySelector('select[name="bcdSize"]') as HTMLSelectElement;
    fireEvent.change(bcdSelect, { target: { value: "L" } });

    // Should be confirmed even though fin size is not provided
    expect(indicator).toHaveTextContent("Gear matched and pre-packed.");
  });
});

describe("RentalFitForm currency (task 35)", () => {
  it("prices the rental list in the shop's currency, not dollars", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="mxn"
      />,
    );

    // 1500 minor units of MXN is $15.00 in pesos — the glyph and the grouping
    // both come from the currency, never a hardcoded USD formatter.
    expect(screen.getByText("MX$15.00")).toBeInTheDocument();
    expect(screen.queryByText("$15.00")).not.toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="jpy"
      />,
    );

    // JPY stores whole yen, so 1500 is ¥1,500 — a literal `/ 100` would
    // quote the BCD at ¥15.
    expect(screen.getByText("¥1,500")).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });
});
