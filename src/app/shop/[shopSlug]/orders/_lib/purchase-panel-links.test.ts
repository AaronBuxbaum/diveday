import { expect, it } from "vitest";
import { purchasePanelHref } from "./purchase-panel-links";

it("preserves ledger filters but never opens both invoice and receipt panels", () => {
  const search = {
    q: "Shirt & fins",
    status: "paid",
    range: "all",
    personId: "payer",
    page: "2",
    add: "1",
    purchase: "1",
    notice: "old",
    bookingId: "seat",
  };
  expect(purchasePanelHref("blue-mantis", search, false)).toBe(
    "/shop/blue-mantis/orders?q=Shirt+%26+fins&status=paid&range=all&personId=payer&page=2",
  );
  expect(purchasePanelHref("blue-mantis", search, true)).toContain("&purchase=1");
});
