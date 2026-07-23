import { expect, signedInAsOwner, test } from "./fixtures";

// The seeded demo carries a billing history whose orders have fabricated Stripe
// ids (the demo never connects an account). The Stripe-calling controls —
// Refund on the diver profile, Refresh/Void/Refund on the order page — are
// disabled on a demo shop with a hover reason, and the actions refuse before any
// Stripe call (ADR 20260723-owner-reporting; src/db/seed.ts).

test.describe("demo billing history", () => {
  signedInAsOwner();

  test("a paid demo order's refund control is disabled with a reason", async ({ page }) => {
    // A seeded historical diver with a paid invoice on file.
    await page.goto("/shop/blue-mantis/divers");
    await page
      .getByRole("row")
      .filter({ hasText: "Grace Halloran" })
      .getByRole("link")
      .first()
      .click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();

    const refund = page.getByRole("button", { name: "Refund" }).first();
    await expect(refund).toBeVisible();
    await expect(refund).toBeDisabled();
    await expect(refund).toHaveAttribute("title", /demo order/i);

    // The order page reached from the same row disables its Stripe actions too.
    await page.getByRole("link", { name: "Open payment" }).first().click();
    await page.waitForURL(/\/orders\//);
    const orderRefund = page.getByRole("button", { name: /Refund|Void|Refresh/ }).first();
    await expect(orderRefund).toBeDisabled();
    await expect(page.getByText(/backed by a live Stripe invoice/i)).toBeVisible();
  });
});
