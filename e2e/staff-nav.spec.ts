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

/**
 * The other half of what the dock bought: with the tabs off the header, a
 * phone header holds only the logo, the shop's name, and two icon buttons, so
 * the name gets the width the tab rows used to take. It kept a 10rem clamp
 * from before that — a shop whose name ran past about twenty characters read
 * as "Blue Horizon Dive Ch…" with 80px of empty header beside it.
 *
 * Driven against a freshly onboarded shop because the seeded demo shop's name
 * is short enough to fit either way — the clamp is invisible until a name is
 * long enough to hit it.
 */
test.describe("a long shop name on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uses the width the phone dock freed, and keeps the header one row", async ({ page }) => {
    const unique = `long-name-${Date.now()}`;
    await page.goto("/onboard");
    await page
      .locator('input[name="shopName"]')
      .filter({ visible: true })
      .fill("Blue Horizon Dive Charters");
    await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
    await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
    await page
      .locator('input[name="ownerEmail"]')
      .filter({ visible: true })
      .fill(`${unique}@example.com`);
    await page
      .locator('input[name="ownerPassword"]')
      .filter({ visible: true })
      .fill("trial-pass-123");
    await page.getByRole("button", { name: "Create shop & start trial" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));

    const name = page
      .locator("header [data-identity-menu] span")
      .filter({ hasText: /Blue Horizon/ });
    await expect(name).toHaveText("Blue Horizon Dive Charters");
    // Rendered whole, and wider than the 10rem clamp that used to cut it.
    const width = await name.evaluate((el) => ({
      shown: el.clientWidth,
      wants: el.scrollWidth,
    }));
    expect(width.shown).toBe(width.wants);
    expect(width.shown).toBeGreaterThan(160);

    // Taking the width must not cost a second header row: past the point where
    // the name genuinely runs out of room it truncates, and the flex row never
    // wraps the search buttons under it.
    const trigger = page.locator("header [data-identity-menu]");
    const search = page.locator("header").getByRole("button", { name: "Search" });
    const [triggerBox, searchBox] = await Promise.all([
      trigger.boundingBox(),
      search.boundingBox(),
    ]);
    if (!triggerBox || !searchBox) throw new Error("header controls have no box");
    expect(Math.abs(triggerBox.y - searchBox.y)).toBeLessThan(triggerBox.height);
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(searchBox.x);
    // And nothing spilled sideways off the phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
