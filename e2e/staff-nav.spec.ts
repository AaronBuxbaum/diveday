import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

/** The header's "More" disclosure — a <summary>, which has no ARIA role of its own. */
function moreMenu(page: Page) {
  return page.locator("header summary").filter({ hasText: "More" });
}

/**
 * The header nav, the command palette, and the keyboard shortcuts all read one
 * destination registry (src/lib/staff-destinations.ts). This spec covers what
 * the nav owes that registry: the "More" menu names its groups, each
 * destination has exactly one door (Orders in the header, Team and Promo codes
 * on the Settings page), Settings comes last, and a role-gated destination is
 * absent rather than disabled (ADR 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  test("the More menu names its groups, carries Orders, and ends at Settings", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    // "Board", not "Schedule": the public schedule is a different page at a
    // different URL, and staff call this one the board.
    await expect(page.getByRole("link", { name: "Board", exact: true })).toBeVisible();

    await moreMenu(page).click();
    const daily = page.getByRole("list", { name: "Run the shop" });
    const setup = page.getByRole("list", { name: "Set up" });
    await expect(daily).toBeVisible();
    await expect(setup).toBeVisible();

    // Money the shop reads daily — it used to be reachable only from Settings,
    // the palette, or a deep link. Now it is here and *only* here: the Settings
    // page no longer carries a second Orders card.
    await expect(setup.getByRole("link", { name: "Orders" })).toHaveCount(0);

    // The reverse duplicate: Team and Promo codes both have a Settings card, so
    // the header stops offering them too. Settings is the last row in the menu.
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Promo codes" })).toHaveCount(0);
    await expect(setup.getByRole("link")).toHaveText(["Settings"]);

    await daily.getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);

    // The waivers destination is the tabbed shell, so it's named for what it
    // covers rather than for one of its two tabs.
    await moreMenu(page).click();
    await expect(
      page.getByRole("list", { name: "Run the shop" }).getByRole("link", { name: "Waivers" }),
    ).toBeVisible();
  });
});

test.describe("captain", () => {
  signedInAs("captain");

  test("a gated destination is absent from the nav, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await moreMenu(page).click();

    const daily = page.getByRole("list", { name: "Run the shop" });
    // Ungated day-to-day surfaces are all still here.
    await expect(daily.getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(daily.getByRole("link", { name: "Staffing" })).toBeVisible();
    // H-14 surfaces are simply not in the list.
    await expect(daily.getByRole("link", { name: "Waivers" })).toHaveCount(0);
    await expect(daily.getByRole("link", { name: "Reports" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Promo codes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
  });
});
