import { expect, signedInAsOwner, test } from "./fixtures";
import { openOnThisPhone, openTripAbout } from "./helpers";

/**
 * Not READ_ONLY, despite neither test submitting anything: both start from a
 * station on Today's day spine, which only renders while
 * blue-mantis has a departure scheduled today. That's a claim about seeded
 * *state*, not about writes, and READ_ONLY only ever promises the latter — a
 * read-only test skips its own reset and inherits whatever the previous
 * same-worker test left behind, so a sibling spec that cancels or moves
 * today's only departure leaves this one staring at "No boats out today"
 * with nothing to click (observed on CI: run 31913664714, shard 1/4, the
 * page snapshot at timeout showed exactly that empty state). Paying the
 * reset restores the invariant these tests actually depend on.
 */

signedInAsOwner();

test("the departure's tabs reach its gear and its manifest", async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // A station's title is the door to its departure (ADR
  // 20260827-clearwater-surface-language, decision 4).
  await page.locator("ol li h3 a").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  // **Four tabs under one header** (ADR 20261001-logbook, decision 3), the
  // Divers tab open, with the stage the departure is in as a pill in the header.
  const tabs = page.getByRole("navigation", { name: "Departure" });
  // Check-in is not one of them: arrival is a state of the Divers roster once
  // a departure's arrivals open (owner, 2026-10-05).
  await expect(tabs.getByRole("link")).toHaveText(["Divers", "Boat", "Gear", "Details"]);
  await expect(tabs.getByRole("link", { name: "Divers" })).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator("header").getByText(/^Stage: (Prep|Check-in|Aboard|Back)$/),
  ).toBeVisible();

  // **The packing list is the Gear tab**, not the bottom of the roster.
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toHaveCount(0);
  await tabs.getByRole("link", { name: "Gear" }).click();
  await expect(page).toHaveURL(/\/prep$/);
  await expect(page.getByRole("heading", { name: "Tanks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Departure" })
    .getByRole("link", { name: "Boat" })
    .click();
  await expect(page).toHaveURL(/\/manifest/);

  // Every per-device preference rests behind the "On this phone" line (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2), the last
  // thing on the page.
  await openOnThisPhone(page);
  const onThisPhone = page
    .locator("details")
    .filter({ has: page.locator("#offline-heading") })
    .first();
  await expect(onThisPhone).toBeVisible();
  const distanceFromPageEnd = await onThisPhone.evaluate((element) => {
    element.scrollIntoView({ block: "end" });
    const scrolling = document.scrollingElement;
    return scrolling
      ? scrolling.scrollHeight - (scrolling.scrollTop + element.getBoundingClientRect().bottom)
      : 0;
  });
  // The quiet desktop emergency footer is part of this surface's document
  // flow, so leave room for its 44px target and the page's bottom padding.
  expect(distanceFromPageEnd).toBeLessThan(120);

  // **And back across to the roster.**
  await page
    .getByRole("navigation", { name: "Departure" })
    .getByRole("link", { name: "Divers" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(page.getByRole("region", { name: "Divers", exact: true })).toBeVisible();
});

test("staff can view or copy a trip's public booking page from its overview", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-write", "clipboard-read"]);
  await page.goto("/shop/blue-mantis");
  await page.locator("ol li h3 a").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  // The booking page stays on screen for a staffer now — it used to redirect
  // straight back to the management view, which made this button impossible to
  // use — and says whose view they are looking at instead.
  await openTripAbout(page);
  const [publicPage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "View public page" }).click(),
  ]);
  await publicPage.waitForLoadState("domcontentloaded");
  await expect(publicPage).toHaveURL(/\/s\/blue-mantis\/trips\/[a-f0-9-]+$/);
  await expect(
    publicPage.getByText("You’re looking at the diver’s view of this departure."),
  ).toBeVisible();
  await publicPage.getByRole("link", { name: "Manage this trip" }).click();
  await expect(publicPage).toHaveURL(/\/shop\/blue-mantis\/trips\/[a-f0-9-]+$/);
  await publicPage.close();

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toMatch(/\/s\/blue-mantis\/trips\/[a-f0-9-]+$/);
});
