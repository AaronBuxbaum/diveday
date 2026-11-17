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
        rentalSets: 6,
        owedCents: 0,
        otherCurrencySeats: 0,
      }}
      locale="en-US"
      t={t}
    />,
  );
  const card = screen.getByRole("region", { name: "Money" });
  expect(card).toHaveTextContent("Collected$1,320.00");
  expect(card).toHaveTextContent("Rentals$180.00 · 6 sets");
  expect(card).toHaveTextContent("OwedNothing");
});
