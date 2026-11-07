// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RentableItemKind, RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: { bcd: 1500, regulator: 1500, wetsuit: 2000, fins: 1000, weights: 500 },
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
        rentalItems={["bcd", "wetsuit", "fins"]}
        course={{ nitroxCompatible: false, includedRentalKinds: ["bcd", "regulator", "weights"] }}
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
        rentalItems={["bcd", "regulator", "wetsuit", "fins", "weights", "nitrox"]}
        course={{ nitroxCompatible: true, includedRentalKinds: ["bcd", "regulator", "weights"] }}
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
        rentalItems={["bcd", "wetsuit", "fins"]}
        course={{ nitroxCompatible: false, includedRentalKinds: [] }}
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

/**
 * **A course fee that includes a set of its own** (issue #2796): the sizes
 * form asks about what the fee includes with no price, keeps the shop's price
 * on the scuba unit and the suit when the fee leaves them out, and leaves the
 * personal gear the fee leaves out to the student.
 */
describe("RentalFitForm on a course that includes a set of kinds", () => {
  const form = (includedRentalKinds: RentableItemKind[]) =>
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "regulator", "wetsuit", "mask", "fins", "weights"]}
        course={{ nitroxCompatible: false, includedRentalKinds }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

  it("asks sizes for the suit, mask and fins the fee includes, with no price anywhere", () => {
    form(["bcd", "regulator", "wetsuit", "mask", "fins", "weights"]);
    expect(
      screen.getByText(
        /^Included with the course: Scuba unit \(BCD, regulator, tank, weights\), Wetsuit, Mask,? and Fins\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Mask/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^Fins/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  it("keeps the scuba unit on offer, at the shop's price, when the fee includes only the suit", () => {
    form(["wetsuit"]);
    expect(screen.getByText(/^Included with the course: Wetsuit\./)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/\$15\.00/);
    // The suit is the fee's.
    expect(document.body.textContent).not.toMatch(/\$20\.00/);
    expect(screen.queryByRole("checkbox", { name: /^Mask/ })).toBeNull();
  });

  it("still sizes a cold-water hood at the shop's price, unticked until the student asks", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "regulator", "weights", "hood", "dive_computer"]}
        course={{ nitroxCompatible: false, includedRentalKinds: ["bcd", "regulator", "weights"] }}
        pricing={{ ...defaultPricing, perItemCents: { hood: 800, dive_computer: 1200 } }}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(screen.getByRole("checkbox", { name: /^Hood/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Dive computer/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
    expect(document.body.textContent).toMatch(/\$8\.00/);
    // Each piece the fee leaves out carries its price; no total under them.
    expect(screen.queryByText(/Estimated rental/)).toBeNull();
  });
});
