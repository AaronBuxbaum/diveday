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

  /**
   * The index is paged (`ORDER_PAGE_SIZE`). Before that it rendered every one
   * of the demo's 323 invoices in a single ~17,700px scroll — the whole table
   * queried and painted on every visit, for a screen nobody reads past the
   * first few rows of.
   */
  test("the order index pages instead of rendering every invoice", async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();

    const rows = page.locator("tbody tr").filter({ visible: true });
    await expect(rows.first()).toBeVisible();
    const firstPageCount = await rows.count();
    expect(firstPageCount).toBeLessThanOrEqual(50);
    // The diver link specifically. The whole row — and even its first cell —
    // carries a mobile-only trip line whose newlines `toHaveText` normalizes
    // away, so comparing either fails on formatting rather than on content.
    const firstDiver = (await rows.first().getByRole("link").first().textContent()) ?? "";

    // The pager states the whole set, not just what is on screen.
    const pager = page.getByRole("navigation", { name: "Order pages" });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText(/Page 1 of \d+/);

    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/[?&]page=2/);
    await expect(page.getByRole("navigation", { name: "Order pages" })).toContainText("Page 2 of");
    // Different invoices, not the same screen re-rendered.
    await expect(page.locator("tbody tr").first().getByRole("link").first()).not.toHaveText(
      firstDiver,
    );

    // And back, without losing the pager.
    await page
      .getByRole("navigation", { name: "Order pages" })
      .getByRole("link", { name: "Previous" })
      .click();
    await expect(page.locator("tbody tr").first().getByRole("link").first()).toHaveText(firstDiver);
  });

  /** A filter has to survive paging, or page 2 quietly shows the unfiltered set. */
  test("paging keeps the active filter", async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=paid");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    const pager = page.getByRole("navigation", { name: "Order pages" });
    if ((await pager.count()) === 0) return; // fewer paid orders than one page
    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/status=paid/);
    await expect(page).toHaveURL(/page=2/);
    for (const badge of await page
      .locator("tbody tr")
      .getByText("Paid")
      .filter({ visible: true })
      .all()) {
      await expect(badge).toBeVisible();
    }
  });
});
