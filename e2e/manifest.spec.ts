import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

// The manifest page primes the offline shell in the background — no tap
// required. Wait for that to land before cutting the network. Polled from
// the page's main world (not waitForFunction's utility world, where the
// worker's controller and cache state can lag) so the three readiness
// signals are read atomically.
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
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Readiness needs attention" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers only —
  // Priya is the boat's one remaining straggler (the rest of the roster
  // already signed their waiver), so she alone has no boarding button while
  // the rest of the roster does.
  const priyaRow = page.locator("li", { hasText: "Priya Sharma" });
  await expect(priyaRow.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark boarded" }).first()).toBeVisible();

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
  // The mobile-only summary tiles (collapsed behind "More stats", sm:hidden)
  // and the desktop-only ones (hidden below sm) both carry this label — at
  // the default desktop test viewport the mobile copy is DOM-first but
  // never visible, so an unfiltered .first() picks it and the assertion
  // below would report "hidden" forever. Filter to the one actually shown.
  await expect(
    page.getByText("Not boarded", { exact: true }).and(page.locator(":visible")).first(),
  ).toBeVisible();
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
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  // The device copy now saves itself automatically once the page has signal —
  // no tap required. Wait for that to land (the offline link only appears
  // once a snapshot exists) before opening it.
  await expect(page.getByRole("link", { name: "Open offline roll call" })).toBeVisible();
  // "Refresh now" stays as the one manual control, for a captain who wants a
  // fresh snapshot immediately rather than wait on the automatic pass.
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText("This device has an up-to-date offline copy.")).toBeVisible();
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
  await expect(page.getByRole("status").filter({ hasText: "Everything's sent" })).toBeVisible();
});

test("a captain who lost the saved copy to storage eviction still lands on a page after a failed reload", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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

  // The snapshot now saves itself automatically, so simulate the ADR's other
  // named failure mode instead — browser storage eviction/clearing site data
  // removing the record between saves.
  //
  // Two things have to hold for an eviction to still be evicted a reload later,
  // and `setOffline` alone only buys the first.
  //
  // It does stop the *current* document from re-saving: every writer in
  // OfflineManifestAutoSave and OfflineManifestManager returns early on
  // `!navigator.onLine`, so cutting the network before the delete (rather than
  // after) closes the window where a tick lands between the two and quietly
  // puts the record back.
  //
  // But `navigator.onLine` reads **true again in the reloaded document** under
  // Playwright's offline emulation — it blocks transport, it does not persist
  // the flag across a navigation. So the reloaded page believes it has signal,
  // starts an auto-save round, and re-populates the store from
  // /api/offline-manifests/upcoming while the assertion below is still waiting.
  // The test then fails saying the empty state is missing, when what actually
  // happened is the eviction was undone a few hundred milliseconds earlier.
  // Refusing that one request is what makes "still no signal" true for the code
  // that asks — and it is the honest simulation, since a captain whose storage
  // was cleared on the boat has no way to refetch either.
  await context.setOffline(true);
  await context.route("**/api/offline-manifests/upcoming*", (route) => route.abort());
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("diveday-offline-manifests");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("failed to clear IndexedDB"));
      }),
  );

  await page.reload();
  // No snapshot survives, so the worker still redirects here rather than
  // letting the reload fail outright — the shell says so plainly instead of
  // fabricating a roster.
  await expect(page).toHaveURL(/\/offline-manifest\?trip=.*checkpoint=after_dive_1/);
  await expect(page.getByText("Nothing saved on this phone yet")).toBeVisible();

  await context.setOffline(false);
});

test("the offline fallback never reaches beyond the manifest route", async ({ page, context }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
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
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();
  await expect(page.getByRole("link", { name: "Open offline roll call" })).toBeVisible();

  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];
  // "after_dive_999" matches the checkpoint shape but doesn't exist on this
  // trip. Before validating against the saved trip's planned-dive count, the
  // manifest lookup silently fell back to departure's roster while the
  // heading and `isDeparture` still read the raw, nonexistent checkpoint —
  // showing one checkpoint's data under another's label.
  await page.goto(`/offline-manifest?trip=${tripId}&checkpoint=after_dive_999`);
  await expect(page.getByRole("heading", { name: "Before departure roll call" })).toBeVisible();
});

test("visiting any shop page auto-saves the near-term board without opening a manifest, and dive.day root falls back to the saved list offline", async ({
  page,
  context,
}) => {
  // The schedule page, not a trip's own manifest — the auto-save component
  // lives in the shop layout, so it runs here too (ADR
  // 20260726-shopwide-offline-manifest-priming).
  await page.goto("/shop/blue-mantis/schedule");
  await waitForShellPrimed(page);

  // A device copy shows up from this single page visit alone — the 48-hour
  // window's auto-save, not the one trip whose manifest someone opened
  // (which is never opened in this test at all).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open("diveday-offline-manifests");
            request.onsuccess = () => {
              const db = request.result;
              const getAllKeys = db
                .transaction("manifests", "readonly")
                .objectStore("manifests")
                .getAllKeys();
              getAllKeys.onsuccess = () => {
                db.close();
                resolve(getAllKeys.result.length);
              };
              getAllKeys.onerror = () => reject(getAllKeys.error);
            };
            request.onerror = () => reject(request.error);
          }),
      ),
    )
    .toBeGreaterThan(0);

  await context.setOffline(true);
  await page.goto("/");
  // The root path's own failed navigation redirects here instead of the
  // browser's offline error, listing every trip already saved.
  await expect(page).toHaveURL(/\/offline-manifest$/);
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toBeVisible();
  await page.getByText("Two-Tank Reef — Molasses & French").click();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(false);
});

test("displays missing diver face-grid on manifest page", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Manifest" })
    .click();

  // Validate the face grid is visible and has missing divers
  await expect(page.locator("#missing-divers-grid")).toBeVisible();
  await expect(page.getByText(/Missing divers/)).toBeVisible();

  // Clicking an avatar scrolls to the corresponding diver row
  const firstAvatar = page.locator("#missing-divers-grid button").first();
  await expect(firstAvatar).toBeVisible();
  await firstAvatar.click();
});
