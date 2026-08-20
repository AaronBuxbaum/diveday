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

describe("RentalFitForm defaults", () => {
  /**
   * The post-booking form keeps seeding from `RentableItem.defaultRented` — it
   * is a *plan*, not a charge, and a diver with nothing on file is best served
   * by the shop's usual kit already ticked. Only the checkout picker
   * (`BookingGearFields`) deliberately ignores that flag, because there the
   * same tick puts money on a card.
   */
  it("still pre-checks the shop's usual kit for a diver with no fit on file", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "mask_fins", "gopro"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    // By role, not label text: "BCD" also prefixes the "BCD size" select.
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Mask & fins/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^GoPro/ })).not.toBeChecked();
  });

  it("lets a saved fit that rents nothing stay empty", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /^BCD/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Mask & fins/ })).not.toBeChecked();
  });
});

describe("RentalFitForm nitrox gate", () => {
  it("drops the nitrox box on a course taught on air", () => {
    // The same two gates the booking page applies (`nitroxAvailableOn`), so a
    // diver cannot be offered enriched air here after being refused it at
    // checkout — or the other way round.
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "nitrox"]}
        course={{ nitroxCompatible: false }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /nitrox/i })).not.toBeInTheDocument();
  });

  it("keeps it on a course that runs on nitrox at a shop that fills it", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "nitrox"]}
        course={{ nitroxCompatible: true }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /nitrox/i })).toBeInTheDocument();
  });
});

describe("RentalFitForm Gear-Status Light-up Indicator", () => {
  it("renders 'Bringing own gear' by default if no rentals selected", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
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
        course={null}
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

  it("renders the recorded-size and dock-check message when all sizes are confirmed", () => {
    const confirmedFit = { ...emptyFit, rentsBcd: true, bcdSize: "M" };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={confirmedFit}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("updates dynamically when user checks a rental and inputs a size", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        course={null}
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
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("renders the recorded-size message for a wetsuit once its size is provided", () => {
    const wetsuitFit = { ...emptyFit, rentsWetsuit: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={wetsuitFit}
        rentalItems={["wetsuit"]}
        course={null}
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

    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("renders the recorded-size message for mask/fins because fin size is optional", () => {
    const finsFit = { ...emptyFit, rentsMaskFins: true };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={finsFit}
        rentalItems={["mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("confirms gear match when BCD size is provided even if optional fin size is empty", () => {
    const mixedFit = { ...emptyFit, rentsBcd: true, rentsMaskFins: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={mixedFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
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
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });
});

describe("RentalFitForm currency (task 35)", () => {
  it("prices the rental list in the shop's currency, not dollars", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
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
        course={null}
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
        course={null}
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
