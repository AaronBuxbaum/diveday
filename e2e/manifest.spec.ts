import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openBoatCheck,
  openManifestPerson,
  openOnThisPhone,
  openTripFromBoard,
  openTripTab,
} from "./helpers";

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
  // Scoped to the roster list, not a bare text match: every unteamed diver's
  // name also appears on the buddy-team builder's checkbox below (ADR
  // 20260804-buddy-teams), so `getByText` is a strict-mode violation here.
  await expect(manifestRow(page, "Priya Sharma")).toBeVisible();

  // At departure the readiness gate hides boarding for blocked divers only —
  // Priya is the boat's one remaining straggler (the rest of the roster
  // already signed their waiver), so she alone has no boarding button while
  // the rest of the roster does. Anchored on the row's own <h3> for the same
  // reason: a team row carries her name inside its "add a member" picker.
  const priyaRow = manifestRow(page, "Priya Sharma");
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

  // One disclosure per row now, not two: the person's own panel holds the
  // contact block, the notes, and the exception control together (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2).
  const priyaPanel = priyaRow.locator("details").first();
  await expect(priyaPanel).toHaveJSProperty("open", false);
  await openManifestPerson(priyaRow);
  await priyaRow
    .getByLabel("Add a note only staff can see")
    .fill("Guest asked to sit out before departure.");
  const manifestUrl = page.url();
  await priyaRow.getByRole("button", { name: "Add private note" }).click();
  // Private notes are independent of roll-call state: the desk can save
  // context before anyone is marked boarded, and the action revalidates this
  // page in place rather than redirecting it.
  await expect(page).toHaveURL(manifestUrl);
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
  // Park the button clear of the sticky header and progress panel before
  // sampling. Playwright scrolls a target into view as part of clicking it, so
  // a button sitting under those overlays moves the page after the sample and
  // the comparison is then against a position the user was never at.
  // **Never one tap from the list** (decision 3): open the person first. Priya
  // is blocked and carries no boarding mark at all, so hers is the row whose
  // only recordable result is this one.
  await openManifestPerson(priyaRow);
  const markNotBoarded = priyaRow.getByRole("button", { name: "Mark not boarded" });
  await markNotBoarded.evaluate((button) => button.scrollIntoView({ block: "center" }));
  // **Where the diver is on screen, not what `window.scrollY` reads.** Those
  // were the same question until the count panel started naming who is still
  // to call: recording the first result inserts the count row and the chip
  // list *above* the roster, and Chromium's scroll anchoring then moves
  // `scrollY` by exactly that much precisely so the reader's view does not
  // move. Asserting on `scrollY` would fail the browser for keeping the
  // promise this test is about — which is that the row a crew member is
  // working stays under their thumb.
  const rowTopBefore = (await priyaRow.boundingBox())?.y ?? Number.NaN;
  await markNotBoarded.click();
  // WP-6: the card settles in place — the button flips to the confirmed state
  // without a full-page redirect, so the roster position never jumps.
  // The settled control's accessible name is its undo-bearing aria-label
  // (PR #607 review) — an aria-label replaces the computed name outright, so
  // "Not boarded ☑️" no longer matches; the visible label is unchanged.
  await expect(
    priyaRow.getByRole("button", { name: "Not boarded — tap again to undo" }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.abs(((await priyaRow.boundingBox())?.y ?? Number.NaN) - rowTopBefore))
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
  // A second row, through the same two steps.
  const tomRow = manifestRow(page, "Tom Okafor");
  await openManifestPerson(tomRow);
  await tomRow.getByRole("button", { name: "Mark not boarded" }).click();
  await expect(page.getByRole("button", { name: "Not boarded — tap again to undo" })).toHaveCount(
    2,
  );
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
  await offlineCopySaved(page);
  // "Refresh now" stays as the one manual control, for a captain who wants a
  // fresh snapshot immediately rather than wait on the automatic pass.
  await openOnThisPhone(page);
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
  // Two lists on this page carry roll-call controls now (H-46), and the crew
  // panel renders *above* the diver list — so every click below names which
  // list it means. An unscoped `.first()` here silently moved to a crew member
  // the moment crew gained buttons, and the diver half of this test stopped
  // testing the diver half.
  const diverList = page.locator("#offline-roll-call");
  const crewList = page.locator("#offline-crew-roll-call");
  // After a dive the offline copy words this control the same way the live
  // manifest does — "not back aboard", never a settled "Not boarded ☑️" (DOM-H3).
  await expect(page.getByRole("button", { name: "Mark not boarded" })).toHaveCount(0);
  await diverList.getByRole("button", { name: "Mark not back aboard" }).first().click();
  // Two live regions exist here (the action message and the connectivity
  // badge); scope to the one carrying the sync message.
  await expect(
    page.getByRole("status").filter({ hasText: "when you're back in service" }),
  ).toBeVisible();

  // The crew half of the same head count, still with the radio off (H-46).
  // Until this shipped a captain offshore could count divers and not crew, and
  // `rollCallCompleteness` needs both — so the after-dive checkpoint, the one
  // where a person may still be in the water, could not be closed at sea at
  // all. The button settling to "Aboard ☑️" is the crew row's own recorded
  // state, so this asserts the write landed on *that* row rather than
  // re-reading the panel's count (which depends on how many crew the seed
  // rosters).
  const crewRow = crewList.getByRole("listitem").first();
  await crewRow.getByRole("button", { name: "Mark aboard" }).click();
  // The settled control's accessible name is its undo-bearing aria-label
  // (PR #607 review), which replaces "Aboard ☑️" rather than extending it.
  await expect(crewRow.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();

  await context.setOffline(false);
  // One message for both queued events — the diver's and the crew member's go
  // through the same sync route and the same reconcile.
  await expect(page.getByRole("status").filter({ hasText: "Everything's sent" })).toBeVisible();
  // And the crew result stuck: reconciled, not rolled back by the server.
  await expect(crewRow.getByRole("button", { name: "Aboard — tap again to undo" })).toBeVisible();
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
  //
  // **A fourth shape, and the last one this can have.** CI produced a reload
  // that did not throw at all (run 31551932833, shard 2/4), which the paragraph
  // above treats as proof the worker served the route. It is not proof: a
  // document can come back offline from Chromium's own HTTP cache or bfcache,
  // with no service worker involved, and that has nothing to do with what this
  // test guards. Widening the regex again would have been the fourth guess at
  // an error string.
  //
  // So the no-throw case is now decided by the one signal that names the
  // culprit directly. `PerformanceNavigationTiming.workerStart` is non-zero
  // **only** when the navigation went through a service worker's fetch
  // handler — the browser's own record of whether the worker answered. If the
  // reload succeeded without the worker, that is the HTTP cache doing its job
  // and no concern of this spec; if the worker answered a `/guests` URL, that
  // is exactly the regression, and it fails here whatever the error shape.
  if (reloadError) {
    expect(reloadError.message).toMatch(
      /ERR_INTERNET_DISCONNECTED|ERR_ABORTED|Not attached to an active page/,
    );
  } else {
    const servedByWorker = await page.evaluate(() => {
      const [navigation] = performance.getEntriesByType(
        "navigation",
      ) as PerformanceNavigationTiming[];
      return (navigation?.workerStart ?? 0) > 0;
    });
    expect(
      servedByWorker,
      "the offline reload succeeded and the service worker is what answered it — the live-manifest pattern has leaked past the manifest route",
    ).toBe(false);
  }
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
  await offlineCopySaved(page);

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
  const chips = page.getByRole("list", { name: "People still to call" });
  await expect(chips).toHaveCount(0);
  const boardTom = manifestRow(page, "Tom Okafor").getByRole("button", { name: "Mark boarded" });
  await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await boardTom.click();
  await expect(page.getByRole("button", { name: "Boarded — tap again to undo" })).toBeVisible();

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

  // Crew are the other half of the head count (DOM-H1) and the half most
  // reliably in the water, so an uncalled crew member is named here too —
  // marked "(crew)" in the same words the buddy panel uses — rather than
  // reaching this panel only as the muted "N crew members still to call".
  const keikoChip = chips.getByRole("link", { name: /Keiko Tanaka \(crew\)/ });
  await expect(keikoChip).toBeVisible();

  // Tapping a chip jumps to that diver's own row.
  await priyaChip.click();
  await expect(page).toHaveURL(/#diver-row-/);
  await expect(manifestRow(page, "Priya Sharma")).toBeInViewport();

  // And a crew chip jumps to that crew member's own row, which is otherwise
  // below the entire diver roster — the anchor is the whole reason the chip
  // is worth more than the count it replaces.
  await keikoChip.click();
  await expect(page).toHaveURL(/#crew-row-/);
  await expect(
    page.locator("li[id^='crew-row-']").filter({ hasText: "Keiko Tanaka" }),
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
    // The settled control's accessible name is its undo-bearing aria-label
    // (PR #607 review), which replaces "Boarded ☑️" rather than extending it.
    const settled = page.getByRole("button", { name: "Boarded — tap again to undo" });
    const settledBefore = await settled.count();
    const next = boardButtons.first();
    await next.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await next.click();
    await expect(settled).toHaveCount(settledBefore + 1);
  }
  await expect(boardButtons).toHaveCount(0);
  // The diver gap is stated by the pinned count row's "Awaiting" entry, which
  // renders only while its number is nonzero — with every diver recorded it
  // is gone. (The crew half keeps its own "N crew members still to call"
  // sentence below, asserted next, because crew have no entry on that row.)
  const progressPanel = page.locator('section[aria-labelledby="roll-call-progress-heading"]');
  const awaitingEntry = progressPanel.locator("dl > div").filter({ hasText: "Awaiting" });
  await expect(awaitingEntry).toHaveCount(0);

  // Every diver has a result — and the checkpoint is still open, naming why:
  // the crew, by name, are the whole crew half (ADR
  // 20260804-crew-roll-call-is-per-person).
  await expect(page.getByRole("heading", { name: "Roll call complete 🎉" })).toHaveCount(0);
  await expect(page.getByText(/crew members still to call/)).toBeVisible();

  const crewAboardButtons = page.getByRole("button", { name: "Mark aboard" });
  for (let guard = 0; guard < 6; guard += 1) {
    const remaining = await crewAboardButtons.count();
    if (remaining === 0) break;
    // Same undo-bearing accessible name, crew side.
    const settled = page.getByRole("button", { name: "Aboard — tap again to undo" });
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
  // **Two steps, always** (ADR 20260827-the-departure-is-two-working-surfaces,
  // decision 3): the highest-consequence claim this app can make is recorded
  // from the person's own panel, never from the row a wet thumb runs down.
  const firstDiverRow = page.locator("#roll-call-list > ul > li").first();
  await openManifestPerson(firstDiverRow);
  const markNotBack = firstDiverRow.getByRole("button", { name: "Mark not back aboard" });
  await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await markNotBack.click();
  // `exact` matters: without it the substring match resolves against the
  // *other* rows' still-unpressed "Mark not back aboard" buttons and settles
  // instantly, so the assertion never waits for this write at all.
  await expect(
    firstDiverRow.getByRole("button", { name: "Not back aboard", exact: true }),
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
  await openManifestPerson(firstDiverRow);
  const clearNotBack = firstDiverRow.getByRole("button", {
    name: "Not back aboard",
    exact: true,
  });
  await clearNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await clearNotBack.click();
  await expect(awaitingEntry).toBeVisible();
  await expect(awaitingEntry).toContainText("1");

  // Crew reach it the same way — a divemaster who did not surface is the same
  // claim about the same kind of body.
  const crewRow = page.locator("li[id^='crew-row-']").first();
  await openManifestPerson(crewRow);
  const crewNotBack = crewRow.getByRole("button", { name: "Mark not back aboard" });
  await crewNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await crewNotBack.click();

  // Both facts, at once: the diver gap on the pinned count row ("Awaiting 1"),
  // and the crew emergency in danger tone that no clerical gap is allowed to
  // suppress.
  await expect(progressPanel.getByText(/1 crew member is not back aboard/)).toBeVisible();
  await expect(awaitingEntry).toBeVisible();
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

  // Behind the "On this phone" line since slice 5a: every per-device
  // preference is one tap away rather than standing at the foot of the boat
  // screen (ADR 20260827-the-departure-is-two-working-surfaces, decision 2).
  await openOnThisPhone(page);
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

  // Blockers and their one fix moved into the person's own panel (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2 — clearing a
  // blocker is ashore work, not something the rail needs standing on the row).
  const blockedRow = manifestRow(page, "Priya Sharma");
  await openManifestPerson(blockedRow);
  const resolve = blockedRow.getByRole("link", { name: /Resolve/i });
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

test("an owner adds and removes a line on the shop's own pre-departure checklist", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/settings/safety-checklist");
  // The seeded demo shop's own list (src/db/seed-pre-departure-checklist.ts).
  await expect(page.getByText("VHF radio checked")).toBeVisible();

  await page.getByLabel("New line").fill("Test kit checked");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Added to the checklist.")).toBeVisible();
  const newRow = page.getByRole("listitem").filter({ hasText: "Test kit checked" });
  await expect(newRow).toBeVisible();

  await newRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Removed from the checklist.")).toBeVisible();
  await expect(page.getByText("Test kit checked")).not.toBeVisible();
});

test("a crew member checks a pre-departure item on the live manifest, and a re-tap undoes it", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  await openBoatCheck(page);
  const item = page.getByRole("button", { name: "VHF radio checked" });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByText(/Checked by .* · /)).toBeVisible();

  // The same control, re-tapped, is the undo (ADR 20260824-pre-departure-safety-check).
  await item.click();
  await expect(page.getByText(/Checked by .* · /)).not.toBeVisible();
});

test("a checklist tap made offline queues, then syncs once signal returns", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");

  await offlineCopySaved(page);
  await openOnThisPhone(page);
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText("Fresh copy")).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Fresh copy")).toBeVisible();

  // The offline viewer, not the live manifest — its own surface, with the
  // checklist still standing open (slice 5a collapses the live manifest's).
  const item = page.getByRole("button", { name: "Fire extinguisher aboard and charged" });
  await item.click();
  await expect(
    page.getByRole("status").filter({ hasText: "when you're back in service" }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Everything's sent" })).toBeVisible();
});

/**
 * Issue #1018. Every refusal in `saveExecutedDiveAction` was a bare `return`,
 * so a divemaster who typed the exit time before the entry time (a
 * transposition — 14:35 in, 14:05 out, one-handed at the rail) saved nothing,
 * was told nothing, and got a form back holding the last saved row. The most
 * likely reading of that is that it saved, and what is written here is what an
 * incident export later seals into a document a physician reads.
 */
test("a transposed dive log entry is refused out loud and keeps what was typed", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await page.getByRole("link", { name: "After dive 1" }).click();
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);

  // The dive log is collapsed to a summary line now (#1055) — it stays on the
  // boat, where the numbers are, but the form is one tap in rather than a third
  // of the screen at every checkpoint.
  const summary = page.locator("summary").filter({ hasText: "Dive 1" });
  await expect(summary).toContainText("not recorded yet");
  await summary.click();

  const log = page.locator("form").filter({ hasText: "Dive 1" });
  await log.getByLabel("Entered the water").fill("2026-07-21T14:35");
  await log.getByLabel("Exited the water").fill("2026-07-21T14:05");
  await log.getByLabel(/Maximum depth/).fill("27");
  await log.getByRole("button", { name: "Save dive record" }).click();

  await expect(log.getByText(/exit time must be after the entry time/).first()).toBeVisible();
  // The whole point: nothing the divemaster entered is lost to the refusal.
  await expect(log.getByLabel("Entered the water")).toHaveValue("2026-07-21T14:35");
  await expect(log.getByLabel("Exited the water")).toHaveValue("2026-07-21T14:05");
  await expect(log.getByLabel(/Maximum depth/)).toHaveValue("27");

  // Correcting the one wrong field is all it takes.
  await log.getByLabel("Exited the water").fill("2026-07-21T15:05");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved.")).toBeVisible();
  // And the summary now states the record rather than its absence, which is
  // what the collapsed row is for.
  await expect(summary).not.toContainText("not recorded yet");
  await expect(summary).toContainText("27");
});
