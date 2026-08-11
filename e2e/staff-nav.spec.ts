import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * The header nav, the command palette, and the keyboard shortcuts all read one
 * destination registry (src/lib/staff-destinations.ts). This spec covers what
 * the nav owes that registry: five tabs and no "More" menu — every header item
 * is a place a shop lives in *during a dive day*, everything demoted keeps its
 * palette row or a contextual door (Reports from Orders' header, Dive sites and
 * Waivers from Settings' cards, Settings itself from the shop-identity menu) —
 * and a role-gated destination is absent rather than disabled (ADR
 * 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  test("the header is five tabs, no More menu, and the demoted doors hold", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    // Scoped to the header: the primary destinations render twice in the DOM
    // (header strip and phone dock), one visible per breakpoint.
    const nav = page.locator("header").getByRole("navigation", { name: "Primary" });
    // "Board", not "Schedule": the public schedule is a different page at a
    // different URL, and staff call this one the board.
    await expect(nav.getByRole("link")).toHaveText([
      /Today/,
      "Check-in",
      "Divers",
      "Board",
      "Orders",
    ]);

    // The "More" menu is gone — a header menu named "More" was the IA
    // admitting it hadn't decided, and with every destination a tab, a
    // palette row, or a contextual door, there is nothing left for it to hold.
    await expect(page.locator("header summary").filter({ hasText: "More" })).toHaveCount(0);

    // The demoted destinations keep real doors on the surfaces that own them.
    await nav.getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("link", { name: "Monthly report" })).toBeVisible();
  });

  test("Settings lives behind the shop's own name, and marks itself current", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    // Not a tab any more: the one destination a shop configures rather than
    // works was taking a sixth of the phone dock.
    const nav = page.locator("header").getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);

    await page.locator("header [data-identity-menu]").click();
    const settings = page.locator("header").getByRole("link", { name: "Settings" });
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    // Door rows: the heading is the link, with no separate CTA label.
    const settingsMain = page.getByRole("main");
    await expect(settingsMain.getByRole("link", { name: "Dive sites", exact: true })).toBeVisible();
    await expect(
      settingsMain.getByRole("link", { name: "Waiver template", exact: true }),
    ).toBeVisible();

    // And it is the "you are here" — including for the pages reached from
    // Settings' own cards, which is what `alsoMatch` is for.
    await page.locator("header [data-identity-menu]").click();
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await settingsMain.getByRole("link", { name: "Dive sites", exact: true }).click();
    await expect(page).toHaveURL(/\/dive-sites/);
    await page.locator("header [data-identity-menu]").click();
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

test.describe("captain", () => {
  signedInAs("captain");

  test("a gated destination is absent from the nav, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const nav = page.locator("header").getByRole("navigation", { name: "Primary" });
    // Ungated daily surfaces are all still tabs.
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    // Settings is owner/manager work, so for a captain it is simply not
    // offered — not in the tabs, and not behind the identity menu either.
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.locator("header [data-identity-menu]").click();
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Promo codes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
  });
});

test.describe("phone dock", () => {
  signedInAsOwner();
  // The one breakpoint story this spec exists to pin: below `lg` the primary
  // destinations live in a fixed bottom tab bar (the phone dock), and the
  // header keeps to identity, search, and sign-out — no wrapped rows of tabs.
  test.use({ viewport: { width: 390, height: 844 } });

  test("the primary destinations are a bottom tab bar, not header rows", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const dock = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
    await expect(dock.getByRole("link")).toHaveText([
      /Today/,
      "Check-in",
      "Divers",
      "Board",
      "Orders",
    ]);

    // The header's own copy of the strip is gone from view on a phone.
    await expect(
      page.locator("header").getByRole("navigation", { name: "Primary" }),
    ).not.toBeVisible();

    // The dock is the thumb's nav: fixed to the bottom edge of the viewport.
    const box = await dock.boundingBox();
    if (!box) throw new Error("dock has no box");
    expect(box.y + box.height).toBeGreaterThan(820);

    // And it navigates: the dock's own tab, not a header row, changes page.
    await dock.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/schedule\/board$/);
    await expect(dock.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
  });

  test("Settings is still one tap away on a phone, from the identity menu", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("header [data-identity-menu]").click();
    await page.locator("header").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});
