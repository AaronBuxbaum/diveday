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

test("the departure reaches its manifest, and carries its packing list", async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // A station's title is the door to its departure (ADR
  // 20260827-clearwater-surface-language, decision 4 — the station carries the
  // day's work, not a second set of destination buttons).
  await page.locator("ol li h3 a").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  // **The packing list is on this page.** Prep stopped being a tab in slice
  // 23c (ADR 20260919-one-idea) — the list a crew works down with their hands
  // full reads under the roster it is derived from, rather than one tap away
  // from it. Its own heading, not the tab's word, is what proves it is here.
  await expect(page.getByRole("heading", { name: "Tanks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toBeVisible();

  // **And there is no strip of nouns above the hour.** The whole point of the
  // slice: the departure is one page, so a nav that offers to take you to
  // parts of it would be offering to take you where you already are.
  await expect(page.getByRole("navigation", { name: "Trip" })).toHaveCount(0);

  // The manifest is the one surface that could not join the page — a
  // `?checkpoint=` URL contract with a service worker and an encrypted offline
  // store hanging off it — so it is one chip in the band.
  await page.getByRole("link", { name: "Manifest" }).click();
  await expect(page).toHaveURL(/\/manifest/);

  // Every per-device preference rests behind the "On this phone" line (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2), so opening
  // that group is how a staffer reaches the boat-mode control at all.
  await openOnThisPhone(page);
  const boatMode = page.getByRole("group", { name: "Boat mode" });
  await expect(boatMode).toBeVisible();
  const distanceFromPageEnd = await boatMode.evaluate((element) => {
    element.scrollIntoView({ block: "end" });
    const scrolling = document.scrollingElement;
    return scrolling
      ? scrolling.scrollHeight - (scrolling.scrollTop + element.getBoundingClientRect().bottom)
      : 0;
  });
  // The grouped device controls sit near the end of the manifest while still
  // leaving room for the page's footer spacing.
  // The quiet desktop emergency footer is part of this surface's document
  // flow, so leave room for its 44px target and the page's bottom padding.
  expect(distanceFromPageEnd).toBeLessThan(120);

  // **And the way back is up, not sideways.** The manifest's eyebrow names the
  // departure it belongs to, which is the page that holds everything else.
  await page.getByRole("link", { name: "Trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(boatMode).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toBeVisible();
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
