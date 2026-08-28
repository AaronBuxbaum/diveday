import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * The header nav, the phone dock, and the command palette all read one
 * destination registry (src/lib/staff-destinations.ts). This spec covers what
 * the nav owes that registry: five primary tabs plus one "More" door carrying
 * everything else — the header menu from `lg` up, the bottom sheet on the
 * dock's sixth slot below it (ADR 20260813-more-is-the-shops-other-door) —
 * with exactly one row anywhere reading as current, and a role-gated
 * destination absent rather than disabled (ADR
 * 20260724-role-gated-surfaces-hide-not-explain).
 */

test.describe("owner", () => {
  signedInAsOwner();

  test("the header is four tabs plus a More menu holding the two groups", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    // Scoped to the header: the primary destinations render twice in the DOM
    // (header strip and phone dock), one visible per breakpoint.
    const nav = page.locator("header").getByRole("navigation", { name: "Primary" });
    // "Board", not "Schedule": the public schedule is a different page at a
    // different URL, and staff call this one the board. **Four, not five**:
    // Close-out left the bar on 2026-08-28 when the evening became a state of
    // the home rather than a destination (H-62), and the room it freed is
    // deliberately unspent. Orders remains reachable from More.
    await expect(nav.getByRole("link")).toHaveText([/Today/, "Check-in", "Divers", "Board"]);
    await expect(nav.getByRole("link", { name: "Close-out" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Divers" }).click();
    await expect(page).toHaveURL(/\/divers$/);
    await expect(nav.getByRole("link", { name: "Divers" })).toHaveAttribute("aria-current", "page");

    await page.goto("/shop/blue-mantis");
    // The More menu holds every other *place*, in two named groups — the
    // operational cadence, then configuration, with Settings closing the menu.
    const more = page.locator("header summary").filter({ hasText: "More" });
    await more.click();
    const menu = page.locator("header details[open]");
    await expect(menu.getByRole("list", { name: "Run the shop" }).getByRole("link")).toHaveText([
      "Staffing",
      "Courses",
      "Dive sites",
      "Gear",
      "Waivers",
      "Reviews",
      "Requests",
      "Orders",
      "Reports",
    ]);
    await expect(menu.getByRole("list", { name: "Set up" }).getByRole("link")).toHaveText([
      "Team",
      "Promo codes",
      "Calendar subscription",
      "Settings",
    ]);

    // A More row navigates and the menu closes behind it.
    await menu.getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.locator("header details[open]")).toHaveCount(0);
    // …and the door that leads here is what reads as current: the More
    // button, not a borrowed Today tab — in color and in the tree, so a
    // screen reader isn't left with five non-current tabs and nothing else.
    await expect(more).toHaveClass(/text-primary/);
    await expect(more).toHaveAttribute("aria-current", "true");
    await more.click();
    await expect(
      page.locator("header details[open]").getByRole("link", { name: "Orders" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("Settings lives in Set up, and only the most specific row lights", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings");
    const more = page.locator("header summary").filter({ hasText: "More" });
    await more.click();
    const menu = page.locator("header details[open]");
    await expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The identity menu is about the reader's own session now — language and
    // sign out — so Settings' one door is this menu (principle 8: never the
    // same destination in two menus).
    await page.keyboard.press("Escape");
    await page.locator("header [data-identity-menu]").click();
    await expect(page.locator("header").getByRole("link", { name: "Settings" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A page reached *from* Settings lights its own row, and Settings' row
    // goes quiet — most specific claim wins, exactly one current row.
    await page.getByRole("main").getByRole("link", { name: "Team", exact: true }).first().click();
    await expect(page).toHaveURL(/\/settings\/team$/);
    await more.click();
    const reopened = page.locator("header details[open]");
    await expect(reopened.getByRole("link", { name: "Team" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(reopened.getByRole("link", { name: "Settings" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the demoted doors on owning surfaces still hold", async ({ page }) => {
    // The monthly report keeps its door on the Orders header — the same
    // money, summed — alongside its own More row.
    await page.goto("/shop/blue-mantis/orders");
    await expect(page.getByRole("link", { name: "Monthly report" })).toBeVisible();
  });
});

test.describe("captain", () => {
  signedInAs("captain");

  test("a gated destination is absent from the nav, not shown and refused", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const nav = page.locator("header").getByRole("navigation", { name: "Primary" });
    // Board is an ungated primary destination; Orders is still visible to a
    // captain, but it lives in More with the other daily work.
    await expect(nav.getByRole("link", { name: "Board" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Orders" })).toHaveCount(0);

    // The More menu shows a captain only what their role can open: the
    // ungated cadence rows, and their own calendar feed — never a disabled
    // Waivers, Reports, Team, Promo codes, or Settings row.
    await page.locator("header summary").filter({ hasText: "More" }).click();
    const menu = page.locator("header details[open]");
    await expect(menu.getByRole("list", { name: "Run the shop" }).getByRole("link")).toHaveText([
      "Staffing",
      "Courses",
      "Dive sites",
      "Gear",
      "Reviews",
      "Orders",
    ]);
    // "Set up" collapses to the one personal row — a visible heading over a
    // single row would be noise, but the group keeps its accessible name.
    await expect(menu.getByRole("list", { name: "Set up" }).getByRole("link")).toHaveText([
      "Calendar subscription",
    ]);
    // Requests is gated with Reports and Promo codes: it holds contact details
    // for people who have not booked, and choosing which unscheduled day gets a
    // boat is desk work, not the captain's.
    for (const gated of ["Waivers", "Requests", "Reports", "Team", "Promo codes", "Settings"]) {
      await expect(menu.getByRole("link", { name: gated })).toHaveCount(0);
    }
  });
});

test.describe("phone dock", () => {
  signedInAsOwner();
  // The one breakpoint story this spec exists to pin: below `lg` the primary
  // destinations live in a fixed bottom tab bar (the phone dock) whose sixth
  // slot is the More sheet, and the header keeps to identity and search.
  test.use({ viewport: { width: 390, height: 844 } });

  test("the primary destinations are a bottom tab bar, not header rows", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    const dock = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
    await expect(dock.getByRole("link")).toHaveText([
      /Today/,
      "Check-in",
      "Divers",
      "Board",
      "Close",
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

  test("the More sheet puts the whole shop two thumb-taps away", async ({ page }) => {
    await page.goto("/shop/blue-mantis");

    // Tap one: the dock's sixth slot.
    const moreButton = page.locator("[data-dock-more]");
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    // The sheet rises from the dock with the same two groups the desktop
    // menu holds, rendered by the same components.
    const sheet = page.locator("nav").getByRole("list", { name: "Run the shop" });
    await expect(sheet.getByRole("link", { name: "Staffing" })).toBeVisible();

    // The sheet follows its trigger in the DOM, so the keyboard walks into
    // what it just disclosed: Tab from the More button lands on the first row.
    await page.keyboard.press("Tab");
    await expect(sheet.getByRole("link", { name: "Staffing" })).toBeFocused();

    // Every row is a real touch target (dock test: >= 44px).
    const rowBox = await sheet.getByRole("link", { name: "Staffing" }).boundingBox();
    if (!rowBox) throw new Error("sheet row has no box");
    expect(rowBox.height).toBeGreaterThanOrEqual(44);

    // Tap two: Settings, at the end of Set up.
    await page
      .locator("nav")
      .getByRole("list", { name: "Set up" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(page).toHaveURL(/\/settings$/);
    // The sheet closed with the navigation, and the More slot is what reads
    // as current for a page that lives behind it — in color and in the tree.
    await expect(page.getByRole("list", { name: "Set up" })).toHaveCount(0);
    await expect(moreButton).toHaveClass(/text-primary/);
    await expect(moreButton).toHaveAttribute("aria-current", "true");
  });

  test("the sheet dismisses on an outside tap without navigating", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await page.locator("[data-dock-more]").click();
    await expect(page.getByRole("list", { name: "Run the shop" })).toBeVisible();
    // A tap on the dimmed page above the sheet just closes it — no second
    // tap owed. Coordinates, because what a finger actually hits there is
    // the scrim, not a control — derived from the sheet's own top edge, so
    // the sheet growing a row (as it did when Gear joined the register)
    // cannot move it up underneath a hard-coded point.
    const sheetBox = await page.getByRole("dialog", { name: "More" }).boundingBox();
    if (!sheetBox) throw new Error("sheet has no box");
    await page.mouse.click(195, Math.max(16, sheetBox.y - 40));
    await expect(page.getByRole("list", { name: "Run the shop" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
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
