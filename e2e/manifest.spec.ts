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
  // The worker is a build output (scripts/build-service-worker.mjs), not a
  // committed file — `public/manifest-sw.js` is gitignored. When it is absent
  // registration fails silently and the poll below can only report
  // "Received: false" after an 8s timeout, five times over, naming nothing.
  // That is exactly how this landed on CI: `public/` is served off the
  // filesystem and `next build` never copies it into `.next/`, so the job that
  // restored the build artifact into a fresh checkout had no worker to serve.
  // One request, up front, so the cause is in the failure message.
  const workerResponse = await page.request.get(new URL("/manifest-sw.js", page.url()).toString());
  expect(
    workerResponse.status(),
    "/manifest-sw.js is not being served — it is generated and gitignored, so run `pnpm build:sw`",
  ).toBe(200);

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
  // Blocked divers are said once, in the checkpoint panel, as a sentence
  // about what blocked *means here* — the standalone "Blocked divers" banner
  // that used to restate the panel's own count is gone. The count itself is
  // asserted below, on the panel's count row.
  await expect(page.getByText(/still on this manifest, but cannot board/)).toBeVisible();
  // Her own row heading, not a bare text match: every unteamed diver's name
  // also appears on the buddy-team builder's checkbox below (ADR
  // 20260804-buddy-teams), so `getByText` is a strict-mode violation here.
  await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers only —
  // Priya is the boat's one remaining straggler (the rest of the roster
  // already signed their waiver), so she alone has no boarding button while
  // the rest of the roster does. Anchored on the row's own <h3> for the same
  // reason: a team row carries her name inside its "add a member" picker.
  const priyaRow = page
    .locator("#roll-call-list li")
    .filter({ has: page.getByRole("heading", { name: "Priya Sharma", exact: true }) });
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

  await page.getByText("Add a note").first().click();
  await page
    .getByLabel("Note", { exact: true })
    .first()
    .fill("Guest asked to sit out before departure.");
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
  await expect(page.getByRole("button", { name: "Not boarded ☑️" }).first()).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - rollCallScroll))
    .toBeLessThan(100);
  await expect(page).not.toHaveURL(/#roll-call-/);
  // The head count now lives once, in the checkpoint panel's count row —
  // the six summary tiles (three responsive layouts of the same numbers,
  // one of them collapsed behind "More stats") are gone. Scoped to the
  // panel and asserted on the *number* as well as the word: an unscoped
  // text match would also find each row's own `print:inline-flex` status
  // pill, which is in the DOM but never visible on screen.
  const progressPanel = page.locator('section[aria-labelledby="roll-call-progress-heading"]');
  const notBoardedCount = progressPanel.locator("dl > div").filter({ hasText: "Not boarded" });
  await expect(notBoardedCount).toBeVisible();
  await expect(notBoardedCount).toContainText("1");
  // And the row **adds up to the boat**. The entries are mutually exclusive
  // by construction (every diver has at most one result), so the three
  // numbers must total the roster — the row used to carry a fourth,
  // "Blocked", which is a readiness fact overlapping "Awaiting" and made a
  // nine-diver departure read as ten people.
  await expect(progressPanel.getByText("Blocked", { exact: true })).toHaveCount(0);
  const rosterTotal = await page.locator("#roll-call-list > ul > li").count();
  const rowTotal = await progressPanel
    .locator("dl > div dd")
    .evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.textContent), 0));
  expect(rowTotal).toBe(rosterTotal);
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("button", { name: "Not boarded ☑️" })).toHaveCount(2);
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
  // manifest does — "not back aboard", never a settled "Not boarded ☑️" (DOM-H3).
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
  //
  // 35s, not 25: closing the eviction race added a second reload (see the
  // ordering note further down). That is one more navigation, not a slower
  // assertion — every wait in here is still a converging poll or the suite's
  // ordinary 8s.
  test.setTimeout(35_000);
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
  // The fourth way this test has been raced, and the one the delete loop below
  // cannot converge on by itself.
  //
  // `setOffline` blocks transport; it does not make `navigator.onLine` read
  // false, and it certainly does not survive a navigation. So the *reloaded*
  // document believes it has signal and starts an auto-save round — and while
  // aborting `/upcoming` stops that round fetching anything, a round that
  // began in the **old** document before `setOffline` already holds its payload
  // in memory and writes to IndexedDB with no network at all. That write can
  // land after the delete loop's last look and before the reload's read, and
  // the page then correctly renders a roster while the assertion waits for an
  // empty state. It is exactly the failure this test produced on CI (shard 2/4,
  // run 31550980341), and never on an idle machine, because the window is a
  // few hundred milliseconds wide and only a loaded runner sits in it.
  //
  // Making `navigator.onLine` false in every document from here closes it at
  // the source: every writer in OfflineManifestAutoSave and
  // OfflineManifestManager returns early on that flag, so once the reload below
  // has happened *nothing in the page can write to the store at all* — which is
  // what turns the delete into a last word rather than a race. It is also the
  // honest simulation. A captain whose storage was cleared mid-charter has a
  // phone that knows it has no bars, not one that thinks it is online and
  // merely fails every request.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await context.route("**/api/offline-manifests/upcoming*", (route) => route.abort());
  // And the identity endpoint the offline shell itself calls (review 20260802,
  // action item 12 — it used to reach `/upcoming` for the same one string).
  // Nothing it returns can re-create a manifest record, so this is not part of
  // what makes the eviction stick; it is here because a captain whose storage
  // was cleared on the boat cannot reach *any* of this origin's endpoints, and
  // a simulation that lets one of them answer is not the situation being
  // tested.
  await context.route("**/api/offline-manifests/identity*", (route) => route.abort());
  // Reload *before* deleting, into a document that reports no signal. This is
  // the ordering the race above dictates: every writer is now disabled, and the
  // old document — the one that may still have had a save round in flight — is
  // gone with its in-memory payload. Only after this is the store quiet enough
  // for a delete to mean anything. The page still renders the saved roster here
  // (nothing has been deleted yet), which is the point: the record is intact
  // and no longer reachable by any writer.
  await page.reload();
  await expect(page).toHaveURL(/\/offline-manifest\?trip=.*checkpoint=after_dive_1/);

  // Deleting once ought to be enough now, and the loop stays as the proof of
  // it rather than as a way of outlasting a writer: it converges on the first
  // pass, and if it ever stops converging that is a real regression in the
  // "offline means offline" contract above, not a timing problem to wait out.
  // `onblocked` resolves rather than hanging: a still-open connection means
  // "not deleted", which this loop is already the answer to.
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
  // Two assertions, and deliberately neither of them reads the error page's
  // DOM.
  //
  // The reload's thrown message has three legitimate shapes depending on when
  // the chrome-error:// interstitial commits. If it commits while the CDP
  // Page.reload call is still in flight, the target detaches and Playwright
  // reports "Protocol error (Page.reload): Not attached to an active page"
  // instead of the navigation's own ERR_INTERNET_DISCONNECTED. Chromium can
  // also report net::ERR_ABORTED when the interstitial commits during the
  // reload call — the browser is on the offline interstitial either way,
  // which is what this test is about. Matching one shape made this a ~1-in-10
  // flake (reproduced on main,
  // not introduced by any one branch); same commit race d635994 fixed on the
  // setOffline(false) side.
  //
  // Asserting the interstitial's *content* instead was the previous attempt at
  // a fix and was worse: `page.locator("body")` resolves to an empty
  // <body></body> on CI, because the error page is not reliably committed into
  // a DOM this handle can read at assertion time. It passed 30/30 locally and
  // failed on the first CI run — a local pass proves nothing here, so this
  // version is built to not depend on that at all rather than tuned until the
  // runs go green.
  //
  // What is left is sufficient. The regression this guards is the worker
  // swallowing a route outside its manifest pattern, and both of its outcomes
  // are still caught: if the worker served the route, the reload would have
  // *succeeded* and there would be no error; if it redirected to the offline
  // shell, the URL would say so.
  expect(reloadError?.message).toMatch(
    /ERR_INTERNET_DISCONNECTED|ERR_ABORTED|Not attached to an active page/,
  );
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

test("the offline shell asks who it is signed in as without pulling the roster to find out", async ({
  page,
}) => {
  // Review 20260802, action item 12. The shell needs exactly one string — the
  // tenant slug, for the cross-shop purge — and used to get it by calling
  // `/api/offline-manifests/upcoming`, which answers with the shop's whole
  // 48-hour board: diver names, emergency contacts, readiness blockers, onto a
  // shared boat tablet, unread. Asserted in a real browser rather than only at
  // the component seam, because what matters is what leaves the device.
  await page.goto("/shop/blue-mantis/schedule/board");
  await waitForShellPrimed(page);

  // Both routes refuse to be cached. The roster one is the finding's own ask;
  // the identity one matters more, because a cached answer on a shared tablet
  // tells the *next* shop's browser it is the *previous* shop — so the purge
  // deletes the current captain's manifests and keeps the previous shop's.
  for (const path of ["/api/offline-manifests/upcoming", "/api/offline-manifests/identity"]) {
    const response = await page.request.get(new URL(path, page.url()).toString());
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }

  const offlineApiPaths: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/offline-manifests/")) offlineApiPaths.push(pathname);
  });

  // The shell is its own route, outside the staff shop layout that mounts
  // `OfflineManifestAutoSave` — so the only offline-manifest request this
  // navigation can make is the shell's own tenant lookup.
  await page.goto("/offline-manifest");
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await expect.poll(() => offlineApiPaths.includes("/api/offline-manifests/identity")).toBe(true);
  expect(offlineApiPaths).not.toContain("/api/offline-manifests/upcoming");
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

test("the summary panel names who is still to call, one jump chip each", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  // "Who's left?" is a mid-roll-call question: before anyone is recorded the
  // chips would restate the whole roster above the roster itself, so they
  // hold off until the first result lands.
  const chips = page.getByRole("list", { name: "Divers still to call" });
  await expect(chips).toHaveCount(0);
  const boardTom = page
    .locator("#roll-call-list li")
    .filter({ has: page.getByRole("heading", { name: "Tom Okafor", exact: true }) })
    .getByRole("button", { name: "Mark boarded" });
  await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardTom.click();
  await expect(page.getByRole("button", { name: "Boarded ☑️" })).toBeVisible();

  // At the dock these are people still to board — ordinary, expected, and
  // deliberately not called "missing": a recorded not-back-aboard diver is
  // the missing one, and they get a loud row rather than a chip (glossary;
  // DD/D review). The names sit with the count that summarizes them, right
  // under the checkpoint panel — and the one recorded diver's name is gone
  // from them.
  await expect(chips).toBeVisible();
  await expect(chips.getByRole("link", { name: /Tom Okafor/ })).toHaveCount(0);
  await expect(page.getByText(/[Mm]issing divers/)).toHaveCount(0);
  // Priya is blocked at departure, and her chip says the same word her own
  // row does rather than contradicting it.
  const priyaChip = chips.getByRole("link", { name: /Priya/ });
  await expect(priyaChip.getByText("Blocked")).toBeVisible();

  // Tapping a chip jumps to that diver's own row.
  await priyaChip.click();
  await expect(page).toHaveURL(/#diver-row-/);
  await expect(
    page
      .locator("#roll-call-list li")
      .filter({ has: page.getByRole("heading", { name: "Priya Sharma" }) }),
  ).toBeInViewport();
});

test("a checkpoint with every diver counted stays open until the crew are called too", async ({
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
  // Three sequential diver writes plus two crew writes and three corrections,
  // each a full server action round trip — more than the default per-test
  // budget allows for.
  test.setTimeout(90_000);

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Manifest");

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
    const settled = page.getByRole("button", { name: "Boarded ☑️" });
    const settledBefore = await settled.count();
    const next = boardButtons.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(settledBefore + 1);
  }
  await expect(boardButtons).toHaveCount(0);
  // "divers", specifically: the crew half's own line is also "N crew members
  // still to call", and it is *expected* to be showing at this point.
  await expect(page.getByText(/divers? still to call/)).toHaveCount(0);

  // Every diver has a result — and the checkpoint is still open, naming why:
  // the crew, by name, are the whole crew half (ADR
  // 20260804-crew-roll-call-is-per-person).
  await expect(page.getByRole("heading", { name: "Roll call complete 🎉" })).toHaveCount(0);
  await expect(page.getByText(/crew members still to call/)).toBeVisible();

  const crewAboardButtons = page.getByRole("button", { name: "Mark aboard" });
  for (let guard = 0; guard < 6; guard += 1) {
    const remaining = await crewAboardButtons.count();
    if (remaining === 0) break;
    const settled = page.getByRole("button", { name: "Aboard ☑️" });
    const settledBefore = await settled.count();
    const next = crewAboardButtons.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(settledBefore + 1);
  }
  await expect(crewAboardButtons).toHaveCount(0);

  // Every person aboard named by a human: now it closes.
  await expect(page.getByRole("heading", { name: "Roll call complete 🎉" })).toBeVisible();

  // DOM-H3. Now a diver does not come back from dive one. After a dive, the
  // control that isn't "Boarded" says so in those words and never settles into
  // a green-checked "Not boarded ☑️", and the closed checkpoint re-opens —
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
  await expect(page.getByRole("button", { name: "Not boarded ☑️" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roll call complete 🎉" })).toHaveCount(0);
  await expect(page.getByText(/1 diver is not back aboard/)).toBeVisible();

  // DD1. A stated crew emergency must never be hidden behind a clerical diver
  // gap. `rollCallCompleteness` ranks `divers_awaiting` above
  // `crew_not_back_aboard` (other surfaces key off that ranking, so it stays),
  // and the panel used to render only that single top reason — so a boat with
  // a divemaster in the water and a diver uncalled read as a muted "1 diver
  // still to call" and nothing else.
  //
  // Set exactly that state up: clear the diver's result so they are awaiting
  // again, then record a crew member as not back aboard.
  const clearNotBack = page
    .locator("#roll-call-list")
    .getByRole("button", { name: "Not back aboard", exact: true })
    .first();
  await clearNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await clearNotBack.click();
  await expect(page.getByText(/diver still to call/)).toBeVisible();

  const crewNotBack = page.getByRole("button", { name: "Mark not back aboard" }).last();
  await crewNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await crewNotBack.click();

  // Both lines, at once: the diver gap in muted prose, and the crew emergency
  // in danger tone that no clerical gap is allowed to suppress.
  const progressPanel = page.locator('section[aria-labelledby="roll-call-progress-heading"]');
  await expect(progressPanel.getByText(/1 crew member is not back aboard/)).toBeVisible();
  await expect(page.getByText(/diver still to call/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roll call complete 🎉" })).toHaveCount(0);
});

test("the manifest offers a per-device push opt-in without asking for permission first", async ({
  page,
  context,
}) => {
  // The third refresh trigger's only door (ADR 20260804-manifest-web-push).
  // What is asserted here is deliberately narrow: that the control renders, is
  // honest about what it promises, and does *not* request notification
  // permission on load. The subscribe round trip itself needs a real push
  // service, which the fleet has no route to — `DIVEDAY_DISABLE_EXTERNAL_HTTP`
  // blocks it — so it is covered by unit tests over `savePushSubscription` and
  // `pushManifestChanged` instead.

  // Deny rather than grant: a page that requests permission unprompted would
  // still "work" against a granted context and hide the regression. With
  // notifications denied, any permission request on load is a silent failure —
  // and the control must still render its opt-in rather than an error.
  await context.clearPermissions();

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  const optIn = page.getByRole("heading", { name: "Wake this phone" });
  await expect(optIn).toBeVisible();

  // The promise the copy makes is the one the feature can keep. "A ping is a
  // heads-up, not a guarantee" is load-bearing: a captain who reads silence as
  // "nothing changed" is the failure mode this wording exists to prevent, and
  // an earlier draft ("so this phone carries the latest") invited exactly that.
  await expect(page.getByText(/A ping is a heads-up, not a guarantee/)).toBeVisible();

  // Present, and off until someone taps it.
  await expect(page.getByRole("button", { name: "Notify this device" })).toBeVisible();
  await expect(
    page.getByText("This device gets a heads-up when the manifest changes near departure."),
  ).toHaveCount(0);

  // Nothing asked for permission merely by rendering the page: the prompt is
  // behind the button, because a denial on load cannot be retried from here.
  expect(await page.evaluate(() => Notification.permission)).not.toBe("granted");
});

/**
 * The two ways a captain moves around a roll call, both of which the
 * 2026-08-06 review found broken in the same way — the page looked right on
 * arrival and then stopped helping the moment anyone scrolled.
 */
test("the active-checkpoint panel stays pinned for the whole roll call", async ({ page }) => {
  // Three full page loads (board → trip → Manifest tab) against the 15s
  // single-load default; no writes, so nothing like the 90s roll-call budget.
  test.setTimeout(30_000);
  // A phone: the panel matters most where the roster is many screens long.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  const heading = page.locator("#roll-call-progress-heading");
  await expect(heading).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // `sticky` is bounded by its own containing block, so wrapping the card and
  // the prose under it in one short `<section>` un-pinned the panel a few diver
  // rows down the page — visible on arrival, gone by the first name a captain
  // actually had to call.
  await expect(heading).toBeInViewport();
  const box = await heading.boundingBox();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(200);
});

test("resolving a blocker from the manifest lands on that diver, under the blocked filter", async ({
  page,
}) => {
  // Board → trip → Manifest tab → resolve-link navigation: four loads on the
  // 15s single-load default, still read-only.
  test.setTimeout(30_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  const resolve = page.getByRole("link", { name: /Resolve/i }).first();
  await expect(resolve).toBeVisible();
  const href = await resolve.getAttribute("href");
  const bookingAnchor = href?.split("#")[1];
  expect(bookingAnchor, "the resolve link must name the diver it is about").toBeTruthy();

  await resolve.click();
  // The roster's own "Blocked" chip, so the captain arrives at the short list
  // of people who still need something rather than the whole boat.
  await expect(page).toHaveURL(/rf=blocked/);
  const blockedChip = page
    .getByRole("navigation", { name: "Filter the roster" })
    .getByRole("link", { name: /^Blocked/ });
  const blockedCount = Number(/\((\d+)\)/.exec((await blockedChip.textContent()) ?? "")?.[1]);
  expect(blockedCount).toBeGreaterThan(0);
  // The list is now exactly that set, not the whole boat.
  await expect(page.locator('li[id^="booking-"]')).toHaveCount(blockedCount);

  // And actually scrolled to them: a `<Link>` transition does not run the
  // browser's own fragment scroll, so this used to land at the top of a page
  // of ~200px cards with the named diver far below the fold.
  const row = page.locator(`#${bookingAnchor}`);
  await expect(row).toBeInViewport();
});
