import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { tripPathByTitle } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

const REEF_TRIP = "Two-Tank Reef — Molasses & French";

/**
 * Open a seeded dive site's edit form and set its maximum depth.
 *
 * Clears the site-photo box: the seeded briefings carry image URLs, and saving
 * re-runs them through `ingestDiveSiteMedia`, which can't reach an image host
 * from the e2e sandbox and bounces the whole form to `?error=images`. That's
 * unrelated to depth — dropping the photos is the narrowest way to get a
 * clean save.
 *
 * Filled *after* the depth field, not before: this page is a fresh
 * navigation's first interaction, and the very first fill right after
 * `page.goto()` can race the page's own hydration and get silently
 * overwritten by the time the click actually submits — the depth field,
 * touched a moment later once hydration has settled, never loses that race.
 * Same fields, reordered so the vulnerable one goes last.
 */
async function setSiteDepth(page: Page, siteName: string, depth: string, unitLabel: RegExp) {
  await page.goto(`/shop/${SHOP}/dive-sites`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/dive-sites/"]:not([href$="/dive-sites/new"])`)
    .filter({ hasText: siteName })
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no dive-site link for ${siteName}`);
  await page.goto(href);
  await page.getByLabel(unitLabel).fill(depth);
  await page.getByLabel(/Site photo URLs/).fill("");
  await page.getByRole("button", { name: "Save dive site" }).click();
  await expect(page.getByText("Dive site saved.")).toBeVisible();
  return href;
}

/**
 * The staff-visible behaviour of ADR 20260730-site-depth-and-diver-age-surfaces:
 * H-08's depth ceiling as a **warning that never blocks**, and H-21's age,
 * minor badge, and birthday callout on the surfaces a crew actually reads.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("the roster shows a diver's age and flags a minor without blocking them", async ({
    page,
  }) => {
    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}/guests`);

    // The seed gives one diver on this trip a date of birth putting them at 13
    // (src/db/seed.ts), so the roster carries both the age and the minor badge.
    await expect(page.getByText(/Age \d+/).first()).toBeVisible();

    // The warning-tone Badge prepends a decorative aria-hidden glyph
    // (Badge.tsx toneGlyph), so the element's own text is "⚠️Minor", not
    // "Minor" alone.
    const minorBadge = page.getByText("⚠️Minor").first();
    await expect(minorBadge).toBeVisible();

    // The whole point: being a minor is a fact the crew is told, never a gate.
    // The row that carries the badge must not have gained a blocker for it.
    const minorRow = page
      .locator("li", { has: page.getByText("⚠️Minor") })
      .filter({ visible: true })
      .last();
    await expect(minorRow).not.toContainText(/under 18|too young|not permitted/i);
  });

  test("a birthday within the window is celebrated on the roster and in its own section", async ({
    page,
  }) => {
    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}/guests`);

    // The seeded minor's birthday is two days out, so both surfaces fire. The
    // copy is the cake plus the timing — no age, no sentence.
    await expect(page.getByRole("heading", { name: /Celebrations/ })).toBeVisible();
    await expect(page.getByText("in 2 days").first()).toBeVisible();
  });

  test("the manifest carries age and the minor flag to the crew's boarding list", async ({
    page,
  }) => {
    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}/manifest`);

    // A captain reading the boarding list can see it without opening a profile.
    await expect(page.getByText(/Minor · age \d+/).first()).toBeVisible();
  });

  test("a site deeper than a diver's card warns staff but never refuses the booking", async ({
    page,
  }) => {
    // Give the reef site a depth past an Open Water diver's 18 m ceiling.
    await setSiteDepth(page, "Molasses Reef", "32", /Maximum depth/);

    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}/guests`);

    // The warning names both numbers and says plainly that it is not a block.
    const warning = page.getByText(/deeper than the .* their card trains for/).first();
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Not a block");

    // And the diver it is about is still boardable. "Ready", not "Ready to
    // board" — the one readiness vocabulary (src/i18n/readiness-labels.ts) that
    // the roster and the counter share with the manifest.
    await expect(page.getByText("✅Ready", { exact: true }).first()).toBeVisible();

    // On the manifest the same fact is the boarding control being offered at
    // all: a blocked seat gets no "Mark boarded" at departure, and the readiness
    // chip there is now reserved for the exception (only a *blocked* diver
    // wears one), so its absence is the assertion.
    await page.goto(`${tripPath}/manifest`);
    await expect(
      page.locator("#roll-call-list").getByRole("button", { name: "Mark boarded" }).first(),
    ).toBeVisible();
    await expect(page.locator("#roll-call-list").getByText("✅Ready")).toHaveCount(0);
  });

  test("depth is entered and read back in the shop's own unit", async ({ page }) => {
    // Metres by default; the setting is display-and-entry only, so flipping it
    // must never move a stored number.
    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();

    const siteHref = await setSiteDepth(
      page,
      "Christ of the Abyss",
      "18",
      /Maximum depth \(metres\)/,
    );

    // Switch the shop to feet; 18 m must read back as 59 ft, not as 18.
    await page.goto(`/shop/${SHOP}/settings`);
    await page.getByLabel("Show depths in", { exact: true }).selectOption("feet");
    await page.getByRole("button", { name: "Save units" }).click();
    await expect(page.getByText(/Units saved/)).toBeVisible();

    await page.goto(siteHref);
    const feetField = page.getByLabel(/Maximum depth \(feet\)/);
    await expect(feetField).toBeVisible();
    await expect(feetField).toHaveValue("59");

    // A number typed in feet round-trips exactly — the reason the column is
    // floating-point rather than whole metres.
    await feetField.fill("60");
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByText("Dive site saved.")).toBeVisible();
    await page.goto(siteHref);
    await expect(page.getByLabel(/Maximum depth \(feet\)/)).toHaveValue("60");
  });

  test("water temperature is entered and read back in the shop's own unit", async ({ page }) => {
    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);

    // Celsius by default, and the unit is part of the field's label rather
    // than a hint beside it — a bare "Water temp" is how a 27 meant as °F
    // reaches every diver as an 81°F day.
    await page.goto(tripPath);
    await page.getByLabel("Water temp °C").fill("27");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // Its own field, independent of the depth unit even though the two now
    // share a card and a save button: switching only the temperature leaves
    // visibility in metres.
    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();
    await page.getByLabel("Show water temperature in", { exact: true }).selectOption("fahrenheit");
    await page.getByRole("button", { name: "Save units" }).click();
    await expect(page.getByText(/Units saved/)).toBeVisible();

    // 27°C reads back as 81°F — the stored Celsius never moved.
    await page.goto(tripPath);
    await expect(page.getByLabel("Water temp °F")).toHaveValue("81");
    await expect(page.getByLabel("Visibility m")).toBeVisible();

    // And a whole Fahrenheit degree typed in round-trips exactly, which is why
    // the column is floating-point rather than whole Celsius.
    await page.getByLabel("Water temp °F").fill("76");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");
    await page.goto(tripPath);
    await expect(page.getByLabel("Water temp °F")).toHaveValue("76");
  });
});
