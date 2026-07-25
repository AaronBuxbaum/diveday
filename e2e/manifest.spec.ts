import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

// The manifest page primes the offline shell in the background — no tap
// required. Wait for that to land before cutting the network, the same way
// an explicit "Save now" click would. Polled from the page's main world (not
// waitForFunction's utility world, where the worker's controller and cache
// state can lag) so the three readiness signals are read atomically.
async function waitForShellPrimed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
        const cache = await caches.open("diveday-offline-manifest-shell-v1");
        return (
          !!navigator.serviceWorker.controller &&
          !!registration?.active &&
          (await cache.match("/offline-manifest")) !== undefined
        );
      }),
    )
    .toBe(true);
}

test("live manifest retains blocked divers and records an explicit not-boarded result", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Readiness needs attention" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers (the seed
  // reef trip has none ready), so there is nothing to board.
  await expect(page.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);

  await page.locator("#roll-call-list").scrollIntoViewIfNeeded();
  const checkpointScroll = await page.evaluate(() => window.scrollY);
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  // After a dive, roll call is a physical head count — a blocked diver who is
  // aboard can still be recorded present, so boarding is offered here.
  await expect(page.getByRole("button", { name: "Mark boarded" }).first()).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - checkpointScroll))
    .toBeLessThan(100);
  await page
    .getByRole("link", { name: "Before departure" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=departure/);

  await page.getByText("Add a note to this roll-call record").first().click();
  await page.getByLabel("Optional note").first().fill("Guest asked to sit out before departure.");
  // Park the button clear of the sticky header and progress panel before
  // sampling. Playwright scrolls a target into view as part of clicking it, so
  // a button sitting under those overlays moves the page after the sample and
  // the comparison is then against a position the user was never at.
  const markNotBoarded = page.getByRole("button", { name: "Mark not boarded" }).first();
  await markNotBoarded.evaluate((button) => button.scrollIntoView({ block: "center" }));
  const rollCallScroll = await page.evaluate(() => window.scrollY);
  await markNotBoarded.click();
  // WP-6: the card settles in place — the button flips to the confirmed state
  // without a full-page redirect, so the roster position never jumps.
  await expect(page.getByRole("button", { name: "Not boarded ✓" }).first()).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - rollCallScroll))
    .toBeLessThan(100);
  await expect(page).not.toHaveURL(/#roll-call-/);
  await expect(page.getByText("Not boarded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("button", { name: "Not boarded ✓" })).toHaveCount(2);
});

test("captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText(/Saved\. Open the offline roll call/)).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  // Offline reload serves the device copy; its freshness badge reads
  // "Fresh copy".
  await expect(page.getByText("Fresh copy")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  // Two live regions exist here (the action message and the connectivity
  // badge); scope to the one carrying the sync message.
  await expect(
    page.getByRole("status").filter({ hasText: "when you're back in service" }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "caught up" })).toBeVisible();
});

test("a captain who never tapped Save now still lands on a page after a failed reload", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  // Switch checkpoints before losing signal — the redirect should carry this
  // through so a captain mid roll call doesn't land back on "Before departure".
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);

  await waitForShellPrimed(page);

  await context.setOffline(true);
  await page.reload();
  // No snapshot was ever saved, so the worker still redirects here rather
  // than letting the reload fail outright — the shell says so plainly
  // instead of fabricating a roster.
  await expect(page).toHaveURL(/\/offline-manifest\?trip=.*checkpoint=after_dive_1/);
  await expect(page.getByText("Nothing saved on this phone yet")).toBeVisible();

  await context.setOffline(false);
});

test("the offline fallback never reaches beyond the manifest route", async ({ page, context }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await waitForShellPrimed(page);

  // Move to a *different* trip surface — the worker's live-manifest pattern
  // is scoped to the manifest route alone and must not swallow this one too.
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests$/);

  await context.setOffline(true);
  let reloadError: Error | undefined;
  try {
    await page.reload();
  } catch (error) {
    reloadError = error as Error;
  }
  // No redirect exists for this route, so a failed reload surfaces the
  // browser's own offline error exactly as it did before this feature shipped.
  expect(reloadError?.message).toContain("ERR_INTERNET_DISCONNECTED");
  expect(page.url()).not.toContain("/offline-manifest");

  await context.setOffline(false);
});

test("the live manifest response never enters Cache Storage", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await waitForShellPrimed(page);

  // The worker is network-first for the live manifest and only ever caches
  // the data-free offline shell — the authenticated roster response, with
  // emergency contacts and readiness, must never land in Cache Storage.
  const liveManifestCached = await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      if (keys.some((request) => /\/trips\/[^/]+\/manifest/.test(new URL(request.url).pathname))) {
        return true;
      }
    }
    return false;
  });
  expect(liveManifestCached).toBe(false);
});

test("an out-of-range checkpoint in the offline URL falls back to departure, not just its shape", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText(/Saved\. Open the offline roll call/)).toBeVisible();

  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];
  // "after_dive_999" matches the checkpoint shape but doesn't exist on this
  // trip. Before validating against the saved trip's planned-dive count, the
  // manifest lookup silently fell back to departure's roster while the
  // heading and `isDeparture` still read the raw, nonexistent checkpoint —
  // showing one checkpoint's data under another's label.
  await page.goto(`/offline-manifest?trip=${tripId}&checkpoint=after_dive_999`);
  await expect(page.getByRole("heading", { name: "Before departure roll call" })).toBeVisible();
});
