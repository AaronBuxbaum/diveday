// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1500,
    fins: 1000,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1000,
};

const mockAction = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Visual review 2026-10-24, B25: the estimate is one line. The set price is
 * said as the set price, with no struck-through list price and no green
 * "You save" line, and no gray banner stands over the form before the sizes
 * are in. The set-price math is unchanged (H-06).
 */
describe("RentalFitForm's estimate", () => {
  it("says the full-set price in one line, with nothing struck through", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "regulator", "wetsuit", "fins", "weights"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(
      screen.getByText(/the full-set price\. We’ll confirm at the dock\./),
    ).toBeInTheDocument();
    expect(container.querySelector(".line-through, s, del")).toBeNull();
    expect(screen.queryByText(/You save/)).toBeNull();
    expect(screen.getByTestId("gear-status-indicator")).toHaveClass("sr-only");
  });
});
