import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAs, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

/**
 * Settings used to be the longest page in the staff app — three groups of
 * cards past eight phone screens; it is a compact answers-first directory
 * now, but the door problems this spec guards predate that. Two things kept
 * a shop from getting down it: the group headings carried `id`/`scroll-mt`
 * anchors that nothing linked, and two surfaces a shop configures from here —
 * Team and Promo codes — had no card at all, reachable only from the nav's
 * "Set up" menu or ⌘K.
 *
 * This spec is the door test for both. The gating itself is H-14's
 * (e2e/role-permissions.spec.ts); what is asserted here is that the doors
 * exist for whoever may walk through them, and are absent — not disabled, not
 * explained — for whoever may not (ADR 20260724-role-gated-surfaces-hide-not-explain).
 *
 * The anchors moved. They used to be their own `JumpNav` row ("Jump to a
 * section") sitting four lines under the settings sub-nav card and repeating
 * its three group names; the words appear once now, on the sub-nav itself,
 * where each group name *is* the anchor to its section. Same anchors, same
 * assertion, one control.
 */
const SHOP = DEMO_SHOP_SLUG;

test.describe("as owner", () => {
  signedInAs("owner");

  test("the sub-nav reaches each group, and Settings opens Team and Promo codes", async ({
    page,
  }) => {
    await page.goto(`/shop/${SHOP}/settings`);

    // The directory no longer renders a separate jump navigation. The group
    // headings remain the stable anchors for deep links and the cards expose
    // the actual doors.
    await expect(page.locator("h2#money")).toBeVisible();
    await page.goto(`/shop/${SHOP}/settings#data-integrations`);
    await expect(page.locator("h2#data-integrations")).toBeVisible();

    // Team: the row an owner opening Settings to add a colleague looks for.
    // The heading is the link now — a door row carries no separate CTA label.
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByRole("main").getByRole("link", { name: "Team", exact: true }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/settings/team`);
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    // Promo codes: in Money, where the shop's other money is. These cards are
    // the doors on the surface that owns them; the nav's "Set up" group is the
    // other door (ADR 20260813-more-is-the-shops-other-door).
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByRole("main").getByRole("link", { name: "Promo codes", exact: true }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/promos`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Discounts a diver can type" }),
    ).toBeVisible();
  });

  test("a settings sub-page carries a way back and no repeated directory", async ({ page }) => {
    // The six sub-pages used to open under a grouped pill card listing every
    // settings destination — the hub's own directory, repeated above each
    // page's <h1> as permanent chrome, and on a phone the whole first
    // viewport. What a sub-page actually needs is the way back, which its
    // eyebrow now is.
    await page.goto(`/shop/${SHOP}/settings/team`);
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link", { name: "Data export" })).toHaveCount(0);

    // Scoped to `main`: the nav's "Set up" group carries its own Settings
    // link, and this assertion is about the page's own eyebrow.
    await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Shop settings" })).toBeVisible();
  });
});

/**
 * The two rows that *change the shop* rather than open a door. Both write a
 * `shops` column the per-test reset does not restore — it puts back three of
 * them and no others — so each takes a shop of its own (`privateShop`, ADR
 * 20260815-per-test-private-shops).
 *
 * They used to restore the setting in trailing steps, which is worse than it
 * looks: not a `finally`, so any failure before them left the whole worker's
 * shop sitting in `America/Cancun` and de-indexed from search, and every later
 * spec read departure times in the wrong zone.
 */
test.describe("settings that change the shop", () => {
  test("a shop can take its public pages out of search, and put them back", async ({
    page,
    privateShop,
  }) => {
    // The mint and the live sign-in the fixture pays for are inside this
    // test's own budget.
    test.setTimeout(60_000);
    // Being listed used to be a consequence of signing up, with nothing to
    // say so and nothing to undo it (ADR 20260813-search-listing-is-a-choice).
    // The row states which way it is set at rest, and the switch round-trips.
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await openSettingsRow(page, "Search listing");
    const listed = page.getByLabel("List my public pages in search engines");
    await expect(listed).toBeChecked();

    await listed.uncheck();
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(
      page.getByRole("status").filter({ hasText: "hidden from search engines" }),
    ).toBeVisible();
    await expect(page.getByLabel("List my public pages in search engines")).not.toBeChecked();

    // And back on again — the round trip is the claim, not the one-way switch.
    await page.getByLabel("List my public pages in search engines").check();
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(
      page.getByRole("status").filter({ hasText: "listed in search engines" }),
    ).toBeVisible();
  });

  test("a shop can change the zone its whole schedule is read in", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    // Sign-up asked for a timezone once and nothing could change it
    // afterwards, so a shop that clicked past the picker read every departure
    // time, day header, and "sailing today" in US Eastern with no way out.
    await page.goto(`/shop/${privateShop.slug}/settings`);
    // The row states its current zone at rest; the picker waits behind it.
    await openSettingsRow(page, "Timezone");
    const zone = page.getByLabel("Timezone", { exact: true });
    await expect(zone).toHaveValue("America/New_York");

    await zone.selectOption("America/Cancun");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Timezone saved." })).toBeVisible();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("America/Cancun");

    // And back, which is the other half of the claim: the picker is not a
    // one-way door a shop can strand itself behind.
    await page.getByLabel("Timezone", { exact: true }).selectOption("America/New_York");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Timezone saved." })).toBeVisible();
  });
});

test.describe("as divemaster", () => {
  signedInAs("divemaster");

  test("a divemaster does not reach the page at all", async ({ page }) => {
    // This used to check which *cards* a divemaster saw on the settings page.
    // The page itself is owner/manager work now — every card on it changes the
    // shop rather than the day — so the honest assertion is that they never
    // arrive, and are told why rather than silently teleported.
    await page.goto(`/shop/${SHOP}/settings`);

    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?|$)`));
    await expect(page.getByText(/managed by the owner or a manager/i)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  });
});
