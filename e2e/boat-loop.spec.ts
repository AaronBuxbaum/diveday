import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openOnThisPhone, openTripAbout, openTripMenuLink } from "./helpers";

const t = staffTranslator("en-US");

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

test("the trip's phases, its gear and its roll call are each one tap away", async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // A station's title is the door to its departure (ADR
  // 20260827-clearwater-surface-language, decision 4).
  await page.locator("ol li h3 a").first().click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  // The trip is five phases, shown one at a time (ADR 20261117-trip-page-clock);
  // the phase on screen is the one it is in now.
  const phases = page.getByRole("navigation", { name: t("trips.clock.label") });
  await expect(phases.getByRole("link")).toHaveCount(5);
  await expect(phases.locator('a[aria-current="page"]')).toHaveCount(1);
  // The header's stage is the crew's own word or nothing — never a phase
  // the clock made up (UX review 2026-10-10, item 1).
  await expect(
    page.locator("header").getByText(/^Stage: (Prep|Check-in|Aboard|Back)$/),
  ).toHaveCount(0);

  // **The packing list is the Gear page**, not the bottom of the guest list.
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toHaveCount(0);
  await openTripMenuLink(page, t("trips.clock.gear"));
  await expect(page).toHaveURL(/\/prep$/);
  await expect(page.getByRole("heading", { name: "Tanks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental kit", exact: true })).toBeVisible();

  await openTripMenuLink(page, t("trips.clock.rollCall"));
  await expect(page).toHaveURL(/\/manifest/);
  await expect(page.getByRole("heading", { name: "Roll call", exact: true })).toBeVisible();

  // Every per-device preference rests behind the "On this phone" line (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2), the last
  // thing on the page.
  await openOnThisPhone(page);
  const onThisPhone = page
    .locator("details")
    .filter({ has: page.locator("#offline-heading") })
    .first();
  await expect(onThisPhone).toBeVisible();
  await page.getByRole("link", { name: t("manifest.deck.return"), exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
  await expect(page.locator("#roster")).toBeVisible();
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
  const preview = publicPage.getByRole("status").filter({
    has: publicPage.getByRole("link", { name: "Manage this trip", exact: true }),
  });
  await expect(preview).toHaveCount(1);
  await expect(
    preview.getByText(staffTranslator("en-US")("shared.publicPreview.youWorkHere"), {
      exact: true,
    }),
  ).toBeVisible();
  await preview.getByRole("link", { name: "Manage this trip", exact: true }).click();
  await expect(publicPage).toHaveURL(/\/shop\/blue-mantis\/trips\/[a-f0-9-]+$/);
  await publicPage.close();

  // The booking link sits in the fill card's Share, with the past guests to
  // invite, when the departure has any; a plain row when it has none.
  const share = page.locator("#who-wants-in details").filter({ hasText: "Share" });
  if ((await share.count()) > 0) await share.locator("summary").first().click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toMatch(/\/s\/blue-mantis\/trips\/[a-f0-9-]+$/);
});
