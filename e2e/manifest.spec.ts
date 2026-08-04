import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

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
        const cache = await caches.open("diveday-offline-manifest-shell-v2");
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
  // Eight full server round trips — board, trip page, manifest, two checkpoint
  // switches, a note save, and two roll-call writes — each re-rendering a
  // 9-diver manifest. Measured at 12.4s serially against the default 15s
  // ceiling, which leaves no headroom once the config's own parallelism
  // (`E2E_WORKER_COUNT`, cpus/2) puts two workers and two Next servers on the
  // same cores: it then times out reproducibly, and did so before the crew
  // roll-call work landed. Same reasoning as the crew checkpoint test below —
  // the budget bounds a *stuck* test, and this one is simply long.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  // "Blocked divers", not "Readiness needs attention": the shop has one
  // readiness vocabulary now (src/i18n/readiness-labels.ts), and this panel
  // names the same state its diver rows do.
  await expect(page.getByRole("heading", { name: "Blocked divers" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers only —
  // Priya is the boat's one remaining straggler (the rest of the roster
  // already signed their waiver), so she alone has no boarding button while
  // the rest of the roster does.
  const priyaRow = page.locator("li", { hasText: "Priya Sharma" });
  await expect(priyaRow.getByRole("button", { name: "Mark boarded" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark boarded" }).first()).toBeVisible();

  await page.locator("#roll-call-list").filter({ visible: true }).scrollIntoViewIfNeeded();
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
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  // The device copy now saves itself automatically once the page has signal —
  // no tap required. Wait for that to land (the offline link only appears
  // once a snapshot exists) before opening it.
  await expect(page.getByRole("link", { name: "Open offline roll call" })).toBeVisible();
  // "Refresh now" stays as the one manual control, for a captain who wants a
  // fresh snapshot immediately rather than wait on the automatic pass.
  await page.getByRole("button", { name: "Refresh now" }).click();
  // Settled: the button is back from "Refreshing…" and the freshness pill is
  // green. There is deliberately no sentence restating that — the pills and the
  // "Saved … · 0 waiting to send" line already say it, and the card used to
  // carry all three at once (see OfflineManifestManager).
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeVisible();
  await expect(page.getByText("Fresh copy")).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  // Offline reload serves the device copy; its freshness badge reads
  // "Fresh copy".
  await expect(page.getByText("Fresh copy")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  // After a dive the offline copy words this control the same way the live
  // manifest does — "not back aboard", never a settled "Not boarded ✓" (DOM-H3).
  await expect(page.getByRole("button", { name: "Mark not boarded" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mark not back aboard" }).first().click();
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
  // 25s covers this test's own shape, not a slow assertion: the eviction loop
  // below owns a 10s budget by itself, on top of four navigations and the
  // service-worker priming poll. Measured on an idle machine the offline
  // reload's empty state lands 35-450ms after the reload returns, and it still
  // lands at 20x CPU throttling — so nothing here is waiting on a slow render,
  // and the per-assertion override this test used to carry (15s on the empty
  // state) was budgeting for a diagnosis that measurement does not support. It
  // is gone; the assertion runs on the suite's ordinary 8s.
  test.setTimeout(25_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
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
  // Deleting once is not enough, and this is the third distinct way this test
  // has been raced. `setOffline` stops a save *round* from starting, but a
  // round that began just before it already holds its payload in memory and
  // writes to IndexedDB with no network at all — so the record can reappear
  // between the delete and the reload, and the page then correctly renders a
  // manifest while the assertion below waits for the empty state.
  //
  // So: delete, look again a beat later, and delete again until it stays gone.
  // Nothing can legitimately re-create it once it has — the network is down
  // and `/upcoming` is refused — which is what makes this converge rather than
  // merely wait longer. `onblocked` resolves rather than hanging: a still-open
  // connection means "not deleted", which this loop is already the answer to.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase("diveday-offline-manifests");
            request.onsuccess = () => resolve();
            request.onblocked = () => resolve();
            request.onerror = () => reject(request.error ?? new Error("failed to clear IndexedDB"));
          });
          await new Promise((resolve) => setTimeout(resolve, 250));
          const databases = await indexedDB.databases();
          return databases.every((database) => database.name !== "diveday-offline-manifests");
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.reload();
  // No snapshot survives, so the worker still redirects here rather than
  // letting the reload fail outright — the shell says so plainly instead of
  // fabricating a roster.
  await expect(page).toHaveURL(/\/offline-manifest\?trip=.*checkpoint=after_dive_1/);
  // Asserted against the whole shell rather than a bare text locator so a
  // failure prints what the captain would actually have been looking at. The
  // three ways this can legitimately not-be-the-empty-state read identically
  // through `getByText(...).toBeVisible()` ("element(s) not found") and are
  // what sent two previous passes at this test chasing timeouts: still on the
  // "Opening this device's saved copy" state (the store hasn't been read), a
  // roster (the record survived the eviction after all), or the shop's own
  // error boundary. `toContainText` names which one.
  await expect(page.locator("main").filter({ visible: true })).toContainText(
    "Nothing saved on this phone yet",
  );

  await context.setOffline(false);
});

test("the offline fallback never reaches beyond the manifest route", async ({ page, context }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await waitForShellPrimed(page);

  // Move to a *different* trip surface — the worker's live-manifest pattern
  // is scoped to the manifest route alone and must not swallow this one too.
  await openTripTab(page, "Guests");
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
  //
  // Asserted as "the reload failed, and the browser is sitting on its own
  // network-error page" rather than by matching the thrown error's *message*:
  // that message has two legitimate shapes depending on when the
  // chrome-error:// interstitial commits. If it commits while the CDP
  // Page.reload call is still in flight, the target detaches and Playwright
  // reports "Protocol error (Page.reload): Not attached to an active page"
  // instead of the navigation's own ERR_INTERNET_DISCONNECTED — with the
  // browser nonetheless on the offline interstitial, which is the thing this
  // test is actually about. Matching the message made that a ~1-in-10 flake
  // (reproduced on main, not introduced by any one branch); it is the same
  // chrome-error:// commit race d635994 fixed on the setOffline(false) side.
  // The error code in the interstitial's own DOM is not localized, and a
  // worker that wrongly swallowed this route would serve the guests page here
  // instead — so this still fails loudly on the regression it guards.
  expect(reloadError).toBeDefined();
  await expect(page.locator("body")).toContainText("ERR_INTERNET_DISCONNECTED");
  expect(page.url()).not.toContain("/offline-manifest");

  await context.setOffline(false);
});

test("the live manifest response never enters Cache Storage", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
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
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
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
  await page.goto("/shop/blue-mantis/schedule/board");
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
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  // Validate the face grid is visible and has missing divers
  await expect(page.locator("#missing-divers-grid").filter({ visible: true })).toBeVisible();
  await expect(page.getByText(/Missing divers/)).toBeVisible();

  // Clicking an avatar scrolls to the corresponding diver row
  const firstAvatar = page.locator("#missing-divers-grid button").filter({ visible: true }).first();
  await expect(firstAvatar).toBeVisible();
  await firstAvatar.click();
});

test("a checkpoint with every diver counted stays open until the crew are counted too", async ({
  page,
}) => {
  // DOM-H1. Crew are the people most reliably in the water and were not part
  // of the head count at all, so a boat could read "roll call complete" with a
  // divemaster still down.
  //
  // Deliberately *not* the "Molasses & French" boat every other spec drives:
  // this test boards its whole roster, and under `fullyParallel` that would
  // pull the shared trip's roll-call state out from under the tests above.
  // This charter carries three divers and two crew and belongs to no other spec.
  const TRIP = "Afternoon Two-Tank — French Reef";
  // Three sequential roll-call writes plus two crew counts, each a full server
  // action round trip — more than the default per-test budget allows for.
  test.setTimeout(60_000);

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Manifest");

  // Nothing counted yet.
  await expect(page.getByText("No crew count recorded at this checkpoint yet.")).toBeVisible();

  // After a dive, roll call is a head count, so every diver — blocked or not —
  // can be recorded present. That is what makes "all divers counted" reachable.
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);

  const boardButtons = page.getByRole("button", { name: "Mark boarded" });
  // Wait for the *settled* label, not merely "no longer says Mark boarded" —
  // the pending label ("Boarding…") also fails that weaker test, so a count-based
  // loop fires every click before the first write has landed and the page ends
  // up with nine disabled spinners and nothing recorded.
  for (let guard = 0; guard < 20; guard += 1) {
    const remaining = await boardButtons.count();
    if (remaining === 0) break;
    const settled = page.getByRole("button", { name: "Boarded ✓" });
    const settledBefore = await settled.count();
    const next = boardButtons.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(settledBefore + 1);
  }
  await expect(boardButtons).toHaveCount(0);
  await expect(page.getByText(/still to call/)).toHaveCount(0);

  // Every diver has a result — and the checkpoint is still open, naming why.
  await expect(
    page.getByText("Every diver is counted. Confirm how many crew are aboard to close this"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roll call complete ✦" })).toHaveCount(0);

  // A short count does not close it either: this charter carries a captain and
  // a divemaster, so one aboard leaves someone unaccounted for.
  await page.getByLabel("Crew aboard").fill("1");
  await page.getByRole("button", { name: "Confirm crew count" }).click();
  await expect(page.getByText(/1 of 2 crew aboard/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roll call complete ✦" })).toHaveCount(0);

  // Counting the rest is what closes the *count* — and the attestation is
  // append-only, so this supersedes the short count rather than editing it.
  await page.getByLabel("Crew aboard").fill("2");
  await page.getByRole("button", { name: "Confirm crew count" }).click();
  await expect(page.getByText(/2 of 2 crew aboard/)).toBeVisible();

  // DOM-H1's per-person half. "2 of 2 aboard" names nobody, so the checkpoint
  // is still open — and now it says which crew member nobody has called.
  await expect(page.getByRole("heading", { name: "Roll call complete ✦" })).toHaveCount(0);
  await expect(page.getByText(/crew members still to call/)).toBeVisible();

  const crewAboardButtons = page.getByRole("button", { name: "Mark aboard" });
  for (let guard = 0; guard < 6; guard += 1) {
    const remaining = await crewAboardButtons.count();
    if (remaining === 0) break;
    const settled = page.getByRole("button", { name: "Aboard ✓" });
    const settledBefore = await settled.count();
    const next = crewAboardButtons.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(settledBefore + 1);
  }
  await expect(crewAboardButtons).toHaveCount(0);

  // Both halves said out loud by a named human: now it closes.
  await expect(page.getByRole("heading", { name: "Roll call complete ✦" })).toBeVisible();

  // DOM-H3. Now a diver does not come back from dive one. After a dive, the
  // control that isn't "Boarded" says so in those words and never settles into
  // a green-checked "Not boarded ✓", and the closed checkpoint re-opens —
  // which is what the Today queue is simultaneously alarming about.
  await expect(page.getByRole("button", { name: "Mark not boarded" })).toHaveCount(0);
  const markNotBack = page
    .locator("#roll-call-list")
    .getByRole("button", { name: "Mark not back aboard" })
    .first();
  await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await markNotBack.click();
  // `exact` matters: without it the substring match resolves against the
  // *other* rows' still-unpressed "Mark not back aboard" buttons and settles
  // instantly, so the assertion never waits for this write at all.
  await expect(
    page
      .locator("#roll-call-list")
      .getByRole("button", { name: "Not back aboard", exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Not boarded ✓" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roll call complete ✦" })).toHaveCount(0);
  await expect(page.getByText(/1 diver is not back aboard/)).toBeVisible();
});
