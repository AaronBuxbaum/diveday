import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/demo-shop";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, settleStaffHydration, signedInAsOwner, test } from "./fixtures";
import {
  openSettingsRow,
  openTripAbout,
  openTripAboutRow,
  openTripFromBoard,
  tripPathByTitle,
} from "./helpers";

const SHOP = DEMO_SHOP_SLUG;
const staff = staffTranslator("en-US");

const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe.configure({ timeout: 30_000 });

/** Open a seeded dive site's edit form, set its maximum depth, save, and read it back after a reload. */
async function setSiteDepth(page: Page, siteName: string, depth: string, unitLabel: RegExp) {
  await page.goto(`/shop/${SHOP}/dive-sites`);
  // A ledger row's link is the stretched overlay (ADR
  // 20260827-the-shops-shelves): the site's name is its accessible name.
  const href = await page
    .getByRole("link", { name: siteName, exact: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no dive-site link for ${siteName}`);
  await page.goto(href);
  await page.getByLabel(unitLabel).fill(depth);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Dive site saved")).toBeVisible();
  await page.goto(href);
  await expect(page.getByLabel(unitLabel)).toHaveValue(depth);
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
    // (src/db/seed.ts), so the roster carries the manifest's "Minor · age N"
    // badge, the capsule being the word alone. An adult's age waits in the
    // row's reference panel; the minor's is the one the crew acts on (H-21).
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

    // The seeded minor's birthday is two days out: the callout lives once, as
    // the capsule on the celebrating diver's row (`birthdayCalloutText`).
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
    // Give the reef site a depth past an Open Water diver's 60 ft ceiling: the
    // Key Largo demo works in feet, so 105 ft (32 m) is what the field takes.
    await setSiteDepth(page, "Molasses Reef", "105", /Maximum depth/);

    const tripPath = await tripPathByTitle(page, SHOP, REEF_TRIP);
    await page.goto(`${tripPath}`);

    // With junior/full status unconfirmed on the seeded cards, the shared
    // warning names the recorded site depth and asks the crew to verify the
    // applicable card limit before planning; it remains an advisory, not a
    // boarding blocker. The repeated sentence is grouped above the roster.
    const warning = page
      .getByText(staff("trips.roster.depthWarningUnconfirmed", { site: "105", unit: "ft" }), {
        exact: false,
      })
      .first();
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(staff("trips.roster.depthVerificationCard"));
    const juneCard = page.locator("#roster li").filter({ hasText: "June Park" }).first();
    await expect(juneCard.getByText("Depth advisory")).toBeVisible();
    await expect(juneCard.getByText(/deeper than the/)).toHaveCount(0);
    // Lena is 13, so her age-based band differs from the adults'. Her row
    // carries the same explicit card-status check, plus the age/limit check,
    // rather than flattening her evidence into the boat-wide line.
    const lenaCard = page.locator("#roster li").filter({ hasText: "Lena Fischer" }).first();
    const lenaWarning = lenaCard.getByText(
      staff("trips.roster.depthWarningUnconfirmed", { site: "105", unit: "ft" }),
      { exact: false },
    );
    await expect(lenaWarning).toBeVisible();
    await expect(lenaWarning).toContainText(staff("trips.roster.depthVerificationCard"));
    await expect(lenaWarning).toContainText(staff("trips.roster.depthVerificationLimits"));

    // And no diver on this boat is *refused*: an advisory warns, a blocker
    // blocks. June's shared advisory files her under "Still to clear" as open
    // work, so the assertion is the absence of the refusal word on her row.
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
    // Feet by default: the demo is in Key Largo, and units follow the shop's
    // country. The setting is display-and-entry only, so flipping it must
    // never move a stored number.
    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "Units");

    const siteHref = await setSiteDepth(
      page,
      "Christ of the Abyss",
      "60",
      /Maximum depth \(feet\)/,
    );

    // Switch the shop to metres; 60 ft must read back as 18 m, not as 60.
    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "Units");
    await page.getByLabel("Show depths in", { exact: true }).selectOption("meters");
    await page.getByRole("button", { name: "Save units" }).click();
    await expect(page.getByText(/Units saved/)).toBeVisible();

    await page.goto(siteHref);
    const metersField = page.getByLabel(/Maximum depth \(meters\)/);
    await expect(metersField).toBeVisible();
    await expect(metersField).toHaveValue("18");

    // A number typed in metres round-trips exactly too.
    await metersField.fill("18");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Dive site saved")).toBeVisible();
    await page.goto(siteHref);
    await expect(page.getByLabel(/Maximum depth \(meters\)/)).toHaveValue("18");
  });

  test("water temperature is entered and read back in the shop's own unit", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/schedule/board`);
    await openTripFromBoard(page, REEF_TRIP);
    await settleStaffHydration(page);
    const tripPath = new URL(page.url()).pathname;

    // Fahrenheit by default (a Key Largo shop), and the unit is part of the
    // field's label rather than a hint beside it — a bare "Water temp" is how
    // a 27 meant as °C reaches every diver as a 27°F day.
    // The board link has already opened this trip.
    // The conditions form waits behind its disclosure (summary-first
    // Overview) — Publish or Edit, depending on whether the seed already
    // published a prediction for this trip.
    await openTripAbout(page);
    await openTripAboutRow(page, "Conditions");
    await page.getByLabel("Water temp °F").fill("81");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // Its own field, independent of the depth unit even though the two now
    // share a card and a save button: switching only the temperature leaves
    // visibility in feet.
    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "Units");
    await page.getByLabel("Show water temperature in", { exact: true }).selectOption("celsius");
    await page.getByRole("button", { name: "Save units" }).click();
    await expect(page.getByText(/Units saved/)).toBeVisible();

    // 81°F reads back as 27°C — the stored Celsius never moved.
    await page.goto(tripPath);
    // A prediction is published now, so the disclosure reads "Edit".
    await openTripAbout(page);
    await openTripAboutRow(page, "Conditions");
    await expect(page.getByLabel("Water temp °C")).toHaveValue("27");
    await expect(page.getByLabel("Visibility ft")).toBeVisible();

    // And a whole Celsius degree typed in round-trips exactly.
    await page.getByLabel("Water temp °C").fill("24");
    const conditionsRedirect = page.waitForEvent("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return false;
      const url = new URL(frame.url());
      return (
        url.pathname === tripPath &&
        url.searchParams.get("notice") === "conditions" &&
        url.searchParams.get("form") === "conditions"
      );
    });
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await conditionsRedirect;
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // The action revalidates this trip and redirects with the conditions
    // notice, which returns to a fresh Details render with this row open.
    // Capture the URL as the redirect happens: the page consumes and removes
    // its notice after rendering, so a later URL assertion would miss it.
    // Then read the stored Celsius back from that server-rendered form.
    await expect(page.getByLabel("Water temp °C")).toHaveValue("24");
    await expect(page.getByLabel("Visibility ft")).toBeVisible();
  });
});
