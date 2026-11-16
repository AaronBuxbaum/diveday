import { expect, it } from "vitest";
import { parseImportedMoney } from "./import";

it("reads a trailing currency code beside the amount", () => {
  expect(parseImportedMoney("Pay 165.00 EUR", null, "usd")).toEqual({
    amountCents: 16_500,
    currency: "eur",
  });
});
