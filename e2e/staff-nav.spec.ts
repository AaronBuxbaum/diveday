import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * The header nav, the command palette, and the keyboard shortcuts all read one
 * destination registry (src/lib/staff-destinations.ts). This spec covers what
 * the nav owes that registry: six tabs and no "More" menu — every header item
 * is a place a shop lives in daily, everything demoted keeps its palette row
 * or a contextual door (Reports from Orders' header, Dive sites and Waivers
 * from Settings' cards) — and a role-gated destination is absent rather than
 * disabled (ADR 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  test("the header is six tabs, no More menu, and the demoted doors hold", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const nav = page.getByRole("navigation", { name: "Primary" });
    // "Board", not "Schedule": the public schedule is a different page at a
    // different URL, and staff call this one the board.
    await expect(nav.getByRole("link")).toHaveText([
      /Today/,
      "Check-in",
      "Divers",
      "Board",
      "Orders",
      "Settings",
    ]);

    // The "More" menu is gone — a header menu named "More" was the IA
    // admitting it hadn't decided, and with every destination a tab, a
    // palette row, or a contextual door, there is nothing left for it to hold.
    await expect(page.locator("header summary").filter({ hasText: "More" })).toHaveCount(0);

    // The demoted destinations keep real doors on the surfaces that own them.
    await nav.getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("link", { name: "Monthly report" })).toBeVisible();

    await nav.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("link", { name: "Open dive sites" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open waivers" })).toBeVisible();
  });
});

test.describe("captain", () => {
  signedInAs("captain");

  test("a gated destination is absent from the nav, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const nav = page.getByRole("navigation", { name: "Primary" });
    // Ungated daily surfaces are all still tabs.
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    // Settings is owner/manager work, so for a captain it is simply not in
    // the list — never shown and refused.
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Promo codes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
  });
});
