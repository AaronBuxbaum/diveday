import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openSettingsRow, openTripAbout, tripPathByTitle } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe.configure({ timeout: 30_000 });

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
  // The library is a ledger now (ADR 20260827-the-shops-shelves): a row's link
  // is the stretched overlay over the whole row, so it carries the site's name
  // as its accessible name rather than as text content.
  const href = await page
    .getByRole("link", { name: siteName, exact: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no dive-site link for ${siteName}`);
  await page.goto(href);
  await page.getByLabel(unitLabel).fill(depth);
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
    await page.goto(`${tripPath}`);

    // The seed gives one diver on this trip a date of birth putting them at 13
    // (src/db/seed.ts), so the roster carries both facts in one pill — the
    // manifest's own "Minor · age N" badge, the same words on both surfaces.
    // An adult's age is a fact, not a flag, and waits in the row's reference
    // panel; the minor's age is the one the crew acts on at a glance (H-21).
    // No glyph before the word: the guests ledger draws its marks and drops
    // the Badge's emoji (slice 5d) — the capsule is the word alone.
    const minorBadge = page.getByText(/^Minor · age \d+$/).first();
    await expect(minorBadge).toBeVisible();

    // The whole point: being a minor is a fact the crew is told, never a gate.
    // The row that carries the badge must not have gained a blocker for it.
    const minorRow = page
      .locator("li", { has: page.getByText(/^Minor · age \d+$/) })
      .filter({ visible: true })
      .last();
    await expect(minorRow).not.toContainText(/under 18|too young|not permitted/i);
  });

  test("a birthday within the window is celebrated on the diver's own row", async ({ page }) => {
    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}`);

    // The seeded minor's birthday is two days out. Since slice 5d folded the
    // Celebrations panel into the ledger, the callout lives once, as the warm
    // capsule on the celebrating diver's row — subject plus timing, no age,
    // no sentence (`birthdayCalloutText`).
    await expect(page.getByText("Birthday in 2 days").first()).toBeVisible();
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
    await page.goto(`${tripPath}`);

    // The warning names both numbers and says plainly that it is not a block.
    // Eight Open Water divers resolve to the identical sentence, so it is
    // stated once in the shared strip above the roster with its diver count
    // (principle 9); each of their cards wears the two-word chip instead, and
    // the sentence appears nowhere on the card itself.
    const warning = page
      .getByText(/divers: Reaches .* deeper than the .* their certification qualifies them for/)
      .first();
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("This is not a block");
    const juneCard = page.locator("#roster li").filter({ hasText: "June Park" }).first();
    await expect(juneCard.getByText("Depth advisory")).toBeVisible();
    await expect(juneCard.getByText(/deeper than the/)).toHaveCount(0);
    // Lena is 13, so her ceiling comes from her age, not her card — a
    // different sentence that is hers alone, and it keeps its full text on
    // her card: grouping must never flatten a diver whose limit differs into
    // the boat-wide line.
    const lenaCard = page.locator("#roster li").filter({ hasText: "Lena Fischer" }).first();
    await expect(lenaCard.getByText(/deeper than the .* allowed at their age/)).toBeVisible();

    // And no diver on this boat is *refused*: an advisory warns, a blocker
    // blocks, and the ledger keeps the two vocabularies apart. June's shared
    // advisory files her under "Still to clear" as open work, so the honest
    // assertion since slice 5d is the absence of the refusal word on her row
    // — the per-row "🌊Ready" text this used to look for is gone with the
    // grammar that repeated the group's own word down its rows.
    await expect(juneCard.getByText("Blocked")).toHaveCount(0);
    await expect(lenaCard.getByText("Blocked")).toHaveCount(0);

    // On the manifest the same fact is the boarding control being offered at
    // all: a blocked seat gets no "Mark boarded" at departure, and the readiness
    // chip there is now reserved for the exception (only a *blocked* diver
    // wears one), so its absence is the assertion.
    await page.goto(`${tripPath}/manifest`);
    await expect(
      page.locator("#roll-call-list").getByRole("button", { name: "Mark boarded" }).first(),
    ).toBeVisible();
    await expect(page.locator("#roll-call-list").getByText("Ready", { exact: true })).toHaveCount(
      0,
    );
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
    await openSettingsRow(page, "Units");
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
    // The conditions form waits behind its disclosure (summary-first
    // Overview) — Publish or Edit, depending on whether the seed already
    // published a prediction for this trip.
    await openTripAbout(page);
    await page.getByText(/Write a crew prediction|Edit crew prediction/).click();
    await page.getByLabel("Water temp °C").fill("27");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // Its own field, independent of the depth unit even though the two now
    // share a card and a save button: switching only the temperature leaves
    // visibility in metres.
    await page.goto(`/shop/${SHOP}/settings`);
    await expect(page.getByRole("heading", { name: "Units" })).toBeVisible();
    await openSettingsRow(page, "Units");
    await page.getByLabel("Show water temperature in", { exact: true }).selectOption("fahrenheit");
    await page.getByRole("button", { name: "Save units" }).click();
    await expect(page.getByText(/Units saved/)).toBeVisible();

    // 27°C reads back as 81°F — the stored Celsius never moved.
    await page.goto(tripPath);
    // A prediction is published now, so the disclosure reads "Edit".
    await openTripAbout(page);
    await page.getByText("Edit crew prediction", { exact: true }).click();
    await expect(page.getByLabel("Water temp °F")).toHaveValue("81");
    await expect(page.getByLabel("Visibility m")).toBeVisible();

    // And a whole Fahrenheit degree typed in round-trips exactly, which is why
    // the column is floating-point rather than whole Celsius.
    await page.getByLabel("Water temp °F").fill("76");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");
    await page.goto(tripPath);
    await openTripAbout(page);
    await page.getByText("Edit crew prediction", { exact: true }).click();
    await expect(page.getByLabel("Water temp °F")).toHaveValue("76");
  });
});
