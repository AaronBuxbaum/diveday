import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAs, test } from "./fixtures";

/**
 * Settings is the longest page in the staff app — three groups of cards that
 * run past eight phone screens. Two things kept a shop from getting down it:
 * the group headings carried `id`/`scroll-mt` anchors that nothing linked, and
 * two surfaces a shop configures from here — Team and Promo codes — had no
 * card at all, reachable only from the nav's "Set up" menu or ⌘K.
 *
 * This spec is the door test for both. The gating itself is H-14's
 * (e2e/role-permissions.spec.ts); what is asserted here is that the doors
 * exist for whoever may walk through them, and are absent — not disabled, not
 * explained — for whoever may not (ADR 20260724-role-gated-surfaces-hide-not-explain).
 */
const SHOP = DEMO_SHOP_SLUG;

test.describe("as owner", () => {
  signedInAs("owner");

  test("the jump row reaches each group, and Settings opens Team and Promo codes", async ({
    page,
  }) => {
    await page.goto(`/shop/${SHOP}/settings`);

    // A plain in-page anchor per group: the hash lands, and the heading it
    // names is a real target on the page.
    const jump = page.getByRole("navigation", { name: "Jump to a section" });
    await jump.getByRole("link", { name: "Money" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings#money$`));
    // By id, not by accessible name: the group headings are rendered
    // `uppercase` by CSS, and Chromium folds text-transform into the
    // accessible name.
    await expect(page.locator("h2#money")).toBeVisible();

    await jump.getByRole("link", { name: "Data & integrations" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings#data-integrations$`));

    // Team: the card an owner opening Settings to add a colleague looks for.
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByRole("link", { name: "Manage team" }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/settings/team`);
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    // Promo codes: in Money, where the shop's other money is. Settings is now
    // the *only* door to both of these — the header dropped their rows.
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByRole("link", { name: "Manage promo codes" }).click();
    await expect(page).toHaveURL(`/shop/${SHOP}/promos`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Discounts a diver can type" }),
    ).toBeVisible();
  });

  test("a shop can change the zone its whole schedule is read in", async ({ page }) => {
    // Sign-up asked for a timezone once and nothing could change it
    // afterwards, so a shop that clicked past the picker read every departure
    // time, day header, and "sailing today" in US Eastern with no way out.
    await page.goto(`/shop/${SHOP}/settings`);
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

  test("a divemaster sees neither door, and still gets the jump row", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/settings`);

    // Neither gate admits a divemaster, so neither card is on the page —
    // rather than a link that would bounce them straight back here.
    await expect(page.getByRole("link", { name: "Manage team" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Manage promo codes" })).toHaveCount(0);

    // Getting around the page is not gated on anything.
    const jump = page.getByRole("navigation", { name: "Jump to a section" });
    await expect(jump.getByRole("link", { name: "Your shop" })).toBeVisible();
    await jump.getByRole("link", { name: "Money" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/settings#money$`));
  });
});
