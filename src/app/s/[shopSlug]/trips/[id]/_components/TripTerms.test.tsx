// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { TripTerms } from "./TripTerms";
import type { Shop, Trip } from "./types";

/**
 * ADR 20260827-the-divers-thread, decision 2: the money resolves in one block
 * above the button, so nothing under the button may state a figure. This used
 * to carry three lines of arithmetic; the two that were money are
 * `MoneyBlock`'s now.
 */

afterEach(cleanup);

const shop = { timezone: "America/New_York", currency: "usd" } as Shop;

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    priceCents: 9_500,
    depositCents: 3_000,
    cancellationWindowHours: 24,
    startsAt: new Date("2026-08-29T15:00:00Z"),
    course: {
      title: "Open Water",
      priceCents: 40_000,
      eLearningPriceCents: 9_000,
    },
    ...overrides,
  } as Trip;
}

describe("TripTerms", () => {
  it("states the free-cancellation window and nothing else", () => {
    render(<TripTerms shop={shop} trip={trip()} locale={DEFAULT_DIVER_LOCALE} />);

    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument();
    // The deposit split and the course-fee breakdown are `MoneyBlock`'s, above
    // the button, where every other figure on this card is.
    expect(screen.queryByText(/deposit at booking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/course \+/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when the shop states no window", () => {
    // Not an apology for the absence: "Cancellation questions? Ask the shop"
    // invented a worry about money nobody had handed over, and the page's own
    // contact line answers it in one place for every case.
    const { container } = render(
      <TripTerms
        shop={shop}
        trip={trip({ cancellationWindowHours: null })}
        locale={DEFAULT_DIVER_LOCALE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
