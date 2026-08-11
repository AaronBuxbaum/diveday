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

    // A plain in-page anchor per group: the hash lands, and the heading it
    // names is a real target on the page.
    const jump = page.getByRole("navigation", { name: "Settings sections" });
    await jump.getByRole("link", { name: "Money" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings#money$`));
    // By id, not by accessible name: the group headings are rendered
    // `uppercase` by CSS, and Chromium folds text-transform into the
    // accessible name.
    await expect(page.locator("h2#money")).toBeVisible();

    await jump.getByRole("link", { name: "Data & integrations" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings#data-integrations$`));

    // Team: the row an owner opening Settings to add a colleague looks for.
    // The heading is the link now — a door row carries no separate CTA label.
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByRole("main").getByRole("link", { name: "Team", exact: true }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/settings/team`);
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    // Promo codes: in Money, where the shop's other money is. Settings is now
    // the *only* door to both of these — the header dropped their rows.
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

    // Scoped to `main`: the shop's identity menu carries its own Settings link,
    // and this assertion is about the page's own eyebrow.
    await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Shop settings" })).toBeVisible();
  });

  test("a shop can change the zone its whole schedule is read in", async ({ page }) => {
    // Sign-up asked for a timezone once and nothing could change it
    // afterwards, so a shop that clicked past the picker read every departure
    // time, day header, and "sailing today" in US Eastern with no way out.
    await page.goto(`/shop/${SHOP}/settings`);
    // The row states its current zone at rest; the picker waits behind it.
    await openSettingsRow(page, "Timezone");
    const zone = page.getByLabel("Timezone", { exact: true });
    await expect(zone).toHaveValue("America/New_York");

    await zone.selectOption("America/Cancun");
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Timezone saved." })).toBeVisible();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("America/Cancun");

    // Put it back so the rest of this worker's run reads the seeded clock the
    // way every other spec expects.
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
