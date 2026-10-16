// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: { bcd: 1500, regulator: 1500, wetsuit: 2000, mask_fins: 1000, weights: 500 },
  nitroxCents: 1000,
};

const mockAction = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * **A course whose fee includes the gear** (fifth-loop ideas, item 16): the
 * student is asked for sizes and nothing else. No price beside an item, no
 * estimate, and no "ask the shop what's included", because the course says.
 */
describe("RentalFitForm on a course that includes the gear", () => {
  it("asks for sizes with no prices", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "wetsuit", "mask_fins"]}
        course={{ nitroxCompatible: false, gearIncluded: true }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(
      screen.getByText(
        "Your scuba unit (BCD, regulator, tank, weights) comes with the course. Tell us your sizes so it’s ready.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$15\.00/);
    expect(screen.queryByText(/Ask the shop what’s included/)).toBeNull();
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
  });

  it("asks only about the scuba unit, leaves mask and fins to the student, and keeps the extras' prices", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights", "nitrox"]}
        course={{ nitroxCompatible: true, gearIncluded: true }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Mask/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$15\.00/);
    // Not part of the scuba unit, so still the shop's price: the suit and nitrox.
    expect(document.body.textContent).toMatch(/\$20\.00/);
    expect(screen.getByText("I’d like nitrox ($10.00 per dive)")).toBeInTheDocument();
  });

  it("still quotes prices on a course that does not include it", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "wetsuit", "mask_fins"]}
        course={{ nitroxCompatible: false, gearIncluded: false }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(document.body.textContent).toMatch(/\$15\.00/);
    expect(screen.queryByText(/comes with the course/)).toBeNull();
  });
});
