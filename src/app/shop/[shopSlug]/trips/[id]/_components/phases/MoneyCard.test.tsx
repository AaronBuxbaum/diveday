// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { MoneyCard } from "./WrappedPanels";

afterEach(cleanup);
const t = staffTranslator("en-US");

/** Wrapped up's Money card says the three figures, and "Nothing" when nothing is owed. */
it("says what was collected, the rentals, and that nothing is owed", () => {
  render(
    <MoneyCard
      money={{
        currency: "usd",
        collectedCents: 132_000,
        rentalCents: 18_000,
        rentalGuests: 6,
        owedCents: 0,
        otherCurrencySeats: 0,
      }}
      cancelled={false}
      locale="en-US"
      t={t}
    />,
  );
  const card = screen.getByRole("region", { name: "Money" });
  expect(card).toHaveTextContent("Collected$1,320.00");
  expect(card).toHaveTextContent("Rentals$180.00 · 6 guests");
  expect(card).toHaveTextContent("OwedNothing");
});

/** A cancelled trip talks about what came in, never what its guests owe (finding 2). */
it("says only what was collected on a cancelled trip", () => {
  render(
    <MoneyCard
      money={{
        currency: "usd",
        collectedCents: 64_200,
        rentalCents: 0,
        rentalGuests: 0,
        owedCents: 89_500,
        otherCurrencySeats: 0,
      }}
      cancelled
      locale="en-US"
      t={t}
    />,
  );
  const card = screen.getByRole("region", { name: "Money" });
  expect(card).toHaveTextContent("Collected$642.00");
  expect(card).not.toHaveTextContent("Owed");
  expect(card).not.toHaveTextContent("Rentals");
});
