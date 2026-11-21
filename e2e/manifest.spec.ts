import type { Page, Route } from "@playwright/test";
import { CAPTAIN_NAME } from "../src/db/seed/cast";
import { DEMO_TODAY_TRIP_ID } from "../src/db/seed/identifiers";
import {
  DEMO_MEDICAL_ALERT,
  DEMO_MEDICAL_ALERT_DIVER,
  DEMO_MEDICAL_ALERT_TRIP,
} from "../src/db/seed/medical-alert";
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed/trips";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { OFFLINE_MANIFEST_SHELL_VERSION } from "../src/lib/offline-manifests";
import { ROLL_CALL_CAUSAL_HEADERS } from "../src/lib/roll-call-protocol";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  expectSignedOnThread,
  manifestRow,
  offlineCopySaved,
  openBoatCheck,
  openDeckDetails,
  openDeckPerson,
  openDiveLog,
  openDiverFileGroup,
  openedGuestName,
  openFirstRosterRowWith,
  openManifestPerson,
  openOnThisPhone,
  openTripAbout,
  openTripFromBoard,
  openTripTab,
  rosterRow,
  tripIdFromUrl,
  tripPathByTitle,
  waiverRequestLinkAfterSend,
} from "./helpers";
import { IDENTITY_ROUTE, rewriteSavedOfflineRecord, savedOfflineRecordFor } from "./visual-harness";

const staff = staffTranslator("en-US");

signedInAsOwner();

async function recordDeckPerson(page: Page, name: string) {
  await openDeckPerson(page, name);
  await page
    .getByRole("button", { name: staff("manifest.deck.record", { name }), exact: true })
    .click();
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    receipt.getByText(staff("manifest.deck.savedAboard"), { exact: true }),
  ).toBeVisible();
}

async function savedPersonDetails(page: Page, name: string) {
  await openDeckPerson(page, name);
  await page.getByRole("button", { name: staff("manifest.deck.exception"), exact: true }).click();
  return page
    .locator("li[id^='offline-roll-call-'], #offline-crew-roll-call > li")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function deckPeople(page: Page, role: "guest" | "crew") {
  await page.getByRole("button", { name: staff("manifest.deck.find"), exact: true }).click();
  return page
    .locator('[data-deck-screen="find"] li')
    .filter({ hasText: staff(`manifest.deck.${role}`) })
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
}

async function openDeckAttention(page: Page) {
  await page.getByRole("button", { name: staff("manifest.deck.attention"), exact: true }).click();
  await expect(page.locator('[data-deck-screen="attention"]')).toBeVisible();
}

// The manifest page primes the offline shell in the background — no tap
// required. Wait for that to land before cutting the network. Polled from
// the page's main world (not waitForFunction's utility world, where the
// worker's state and cache state can lag) so both readiness signals are read
// atomically.
//
// The worker *activated*, not this page *controlled*: a page whose own
// navigation was in flight when the worker activated is never claimed, and
// waiting on its controller then waits forever (visual run 36103429213; see
// `settleOfflineShellWorker` in visual-harness.ts). Every caller proves the shell
// with a fresh navigation — a reload, a goto — which an activated worker
// controls from its first byte, so that is the state worth waiting for.
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
      page.evaluate(async (version) => {
        const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
        const base = `diveday-offline-manifest-shell-${version}`;
        // Production names the cache by build too (`-<build id>`).
        const name = (await caches.keys()).find((k) => k === base || k.startsWith(`${base}-`));
        const cache = name ? await caches.open(name) : null;
        return (
          registration?.active?.state === "activated" &&
          cache !== null &&
          (await cache.match("/offline-manifest")) !== undefined
        );
      }, OFFLINE_MANIFEST_SHELL_VERSION),
    )
    .toBe(true);
}

async function activeShellState(page: Page, expectedVersion: string, priorCache: string) {
  return page.evaluate(
    async ({ expectedVersion, priorCache }) => {
      const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
      const active = registration?.active;
      if (active?.state !== "activated") return null;
      const version = await new Promise<string | null>((resolve) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
          channel.port1.close();
          resolve(null);
        }, 1_000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          resolve(event.data?.version ?? null);
        };
        active.postMessage({ type: "GET_SHELL_VERSION" }, [channel.port2]);
      });
      // Production names a shell cache by build too (`-<build id>`).
      const named = (base: string) => (key: string) => key === base || key.startsWith(`${base}-`);
      const keys = await caches.keys();
      const cacheName = keys.find(named(`diveday-offline-manifest-shell-${expectedVersion}`));
      const shellCached =
        cacheName !== undefined &&
        Boolean(await (await caches.open(cacheName)).match("/offline-manifest"));
      return { version, shellCached, priorCachePresent: keys.some(named(priorCache)) };
    },
    { expectedVersion, priorCache },
  );
}

// story: ROLL-01
test("live manifest retains blocked divers and records an explicit not-boarded result", async ({
  page,
}) => {
  test.setTimeout(45_000); // Named-person lookup, a note, two checkpoints and two confirmed statements.
  await page.goto(`/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest`);
  await expect(
    page
      .locator("#deck-flow h1")
      .getByRole("button", { name: staff("manifest.deck.home"), exact: true }),
  ).toBeVisible();
  let priyaRow = await manifestRow(page, "Priya Sharma");
  await expect(priyaRow.getByRole("button", { name: "Mark boarded", exact: true })).toHaveCount(0);
  await openDeckPerson(page, "Tom Okafor");
  await expect(
    page.getByRole("button", { name: staff("manifest.deck.record", { name: "Tom Okafor" }) }),
  ).toBeVisible();
  await openDeckDetails(page);
  await page
    .getByRole("link", { name: "After dive 1", exact: true })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  await openDeckDetails(page);
  await openDeckPerson(page, "Priya Sharma");
  await expect(
    page.getByRole("button", { name: staff("manifest.deck.record", { name: "Priya Sharma" }) }),
  ).toBeVisible();
  await openDeckDetails(page);
  await page
    .getByRole("link", { name: "Before departure", exact: true })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=departure/);
  await openDeckDetails(page);
  priyaRow = await manifestRow(page, "Priya Sharma");
  await openManifestPerson(priyaRow);
  await page
    .getByRole("dialog")
    .getByLabel("Add a note only staff can see")
    .fill("Guest asked to sit out before departure.");
  const manifestUrl = page.url();
  await page.getByRole("dialog").getByRole("button", { name: "Add private note" }).click();
  await expect(
    page.getByRole("dialog").getByText("Guest asked to sit out before departure."),
  ).toBeVisible();
  await expect(page).toHaveURL(manifestUrl);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark not boarded", exact: true })
    .click();
  const receipt = page.locator('[data-deck-screen="receipt"]');
  await expect(receipt.getByRole("heading", { name: "Priya Sharma", exact: true })).toBeVisible();
  await expect(
    receipt.getByText(staff("manifest.deck.savedAshore"), { exact: true }),
  ).toBeVisible();
  await expect(
    receipt.getByRole("button", { name: staff("manifest.deck.undo", { name: "Priya Sharma" }) }),
  ).toBeVisible();
  const tomRow = await manifestRow(page, "Tom Okafor");
  await openManifestPerson(tomRow);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark not boarded", exact: true })
    .click();
  await expect(receipt.getByRole("heading", { name: "Tom Okafor", exact: true })).toBeVisible();
  await expect(
    receipt.getByText(staff("manifest.deck.savedAshore"), { exact: true }),
  ).toBeVisible();
});

// story: ROLL-02
test("captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call", async ({
  page,
  context,
}) => {
  // This journey exercises the device copy; the booking smoke covers board navigation.
  await page.goto(`/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest`);
  await expect(
    page
      .locator("#deck-flow h1")
      .getByRole("button", { name: staff("manifest.deck.home"), exact: true }),
  ).toBeVisible();

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
  await expect(
    page.getByText(staff("trips.offlineManifestManager.freshnessCurrent")),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await openDeckDetails(page);
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  // Only an *activated* worker catches the reload below. Neither the pill nor
  // the shell having rendered says its install has finished — under load the
  // reload otherwise reaches the network and fails ERR_INTERNET_DISCONNECTED.
  await waitForShellPrimed(page);
  await context.setOffline(true);
  await page.reload();
  // Offline reload serves the device copy; its header says so (B51, review
  // dde-b 1), and the banner says how old it is.
  await openDeckDetails(page);
  await expect(page.getByText("No signal · device copy")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  await openDeckDetails(page);
  const diverRow = await savedPersonDetails(page, "Diego Alvarez");
  await expect(diverRow.getByRole("button", { name: "Mark not boarded" })).toHaveCount(0);
  await diverRow.getByText("Not back aboard?", { exact: true }).click();
  await diverRow.getByRole("button", { name: "Mark not back aboard", exact: true }).click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
    staff("manifest.deck.savedMissing"),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "when you’re back in service" }),
  ).toBeVisible();

  // Crew use their own named record; a diver result never counts a captain.
  await recordDeckPerson(page, CAPTAIN_NAME);
  await expect(
    page.getByRole("status").filter({ hasText: "when you’re back in service" }),
  ).toBeVisible();
  await page.getByRole("button", { name: staff("manifest.deck.home"), exact: true }).click();
  const expiryWarning = staff("shared.offlineManifest.reconcile.pendingExpiryWarning");
  const tripWarning = page.getByRole("status").filter({ hasText: expiryWarning });
  await expect(tripWarning).toBeVisible();
  await expect(tripWarning).toHaveAttribute("aria-live", "polite");

  // The same pending evidence is actionable from the saved-trip list.
  await page.goto("/offline-manifest");
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  const listWarning = page.getByRole("status").filter({ hasText: expiryWarning });
  await expect(listWarning).toBeVisible();
  await expect(listWarning).toHaveAttribute("aria-live", "polite");
  await expect(page.getByText("Saved copies are recent.", { exact: true })).toBeVisible();
  await expect(page.getByText("All up to date.", { exact: true })).toHaveCount(0);
  await page.goto(`/offline-manifest?trip=${DEMO_TODAY_TRIP_ID}&checkpoint=after_dive_1`);
  await expect(page.getByRole("status").filter({ hasText: expiryWarning })).toBeVisible();
  await context.setOffline(false);
  await expect(
    page
      .locator('[data-deck-screen] > [role="status"]')
      .getByText(staff("shared.offlineManifest.reconcile.allCaughtUp"), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: expiryWarning })).toHaveCount(0);
  const crewRow = await savedPersonDetails(page, CAPTAIN_NAME);
  await expect(
    crewRow.getByRole("button", { name: "Aboard — tap again to undo", exact: true }),
  ).toBeVisible();
});

test("a verified different shop does not show another shop’s pending warning", async ({ page }) => {
  const tripId = await savedOfflineRecordFor(page);
  await rewriteSavedOfflineRecord(page, tripId, {
    shop: { slug: "synthetic-other-shop", name: "Synthetic Other Shop" },
    pendingRollCalls: 1,
  });
  // The helper holds tenant verification unavailable, so the offline copy is
  // initially visible. Restore verification and let the real signed-in shop
  // be the authority for whether that copy can be displayed.
  await page.goto(`/offline-manifest?trip=${tripId}`);
  const warning = page.getByRole("status").filter({
    hasText: staff("shared.offlineManifest.reconcile.pendingExpiryWarning"),
  });
  await expect(warning).toBeVisible();
  await page.unroute(IDENTITY_ROUTE);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("heading", {
      name: staff("shared.offlineManifest.single.removedOtherShopHeading"),
    }),
  ).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect(page.getByText("Synthetic Other Shop")).toHaveCount(0);
});

test("a new shell worker replaces the older cache without losing encrypted roll call", async ({
  page,
  context,
  request,
}) => {
  const oldVersion = `v${Number(OFFLINE_MANIFEST_SHELL_VERSION.slice(1)) - 1}`;
  expect(Number(oldVersion.slice(1))).toBeGreaterThan(0);
  const oldCache = `diveday-offline-manifest-shell-${oldVersion}`;
  const currentCache = `diveday-offline-manifest-shell-${OFFLINE_MANIFEST_SHELL_VERSION}`;
  const workerResponse = await request.get("/manifest-sw.js");
  expect(workerResponse.status()).toBe(200);
  const currentWorker = await workerResponse.text();
  const versionPattern = new RegExp(
    `var OFFLINE_MANIFEST_SHELL_VERSION = "${OFFLINE_MANIFEST_SHELL_VERSION}";`,
  );
  expect(currentWorker).toMatch(versionPattern);

  let serveOldWorker = true;
  const workerRoute = async (route: Route) => {
    const response = await route.fetch();
    if (!serveOldWorker) {
      await route.fulfill({ response });
      return;
    }
    const body = await response.text();
    await route.fulfill({
      response,
      body: body.replace(versionPattern, `var OFFLINE_MANIFEST_SHELL_VERSION = "${oldVersion}";`),
    });
  };
  const blockOfflineApi = (route: Route) => route.abort();
  await context.route("**/manifest-sw.js", workerRoute);

  try {
    const tripPath = await tripPathByTitle(
      page,
      "blue-mantis",
      "Two-Tank Reef — Molasses & French",
    );
    await page.goto(`${tripPath}/manifest`);
    await openDeckDetails(page);
    await page
      .getByRole("link", { name: "After dive 1" })
      .evaluate((link: HTMLElement) => link.click());
    await expect(page).toHaveURL(/checkpoint=after_dive_1/);
    await openDeckDetails(page);
    await offlineCopySaved(page);
    await openOnThisPhone(page);
    await page.getByRole("link", { name: "Open offline roll call" }).click();
    await openDeckDetails(page);
    await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
    await expect
      .poll(() => activeShellState(page, oldVersion, currentCache))
      .toEqual({ version: oldVersion, shellCached: true, priorCachePresent: false });

    await context.setOffline(true);
    await page.reload();
    await openDeckDetails(page);
    await expect(page.getByText("No signal · device copy")).toBeVisible();
    await page.getByRole("button", { name: "After dive 1" }).click();
    await openDeckDetails(page);
    await recordDeckPerson(page, CAPTAIN_NAME);
    await expect(
      page.getByRole("status").filter({ hasText: "when you’re back in service" }),
    ).toBeVisible();

    // Permit the browser's worker update fetch while refusing the manifest
    // reconciliation endpoints, so this queued record remains on-device.
    await context.route("**/api/offline-manifests/**", blockOfflineApi);
    await context.setOffline(false);
    serveOldWorker = false;
    // Wait on the new worker's own lifecycle, not on a 15s poll of its side
    // effects: `update()` resolves with the registration holding the new
    // worker as installing; its `activated` (install and activate finished,
    // the old cache deleted inside activate's waitUntil) or `redundant`
    // (install failed) is the event this test is about.
    const lifecycle = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/manifest-sw.js");
      if (!registration) return "no registration";
      await registration.update();
      const next = registration.installing ?? registration.waiting ?? registration.active;
      if (!next) return "no worker";
      if (next.state !== "activated" && next.state !== "redundant") {
        await new Promise<void>((resolve) => {
          next.addEventListener("statechange", () => {
            if (next.state === "activated" || next.state === "redundant") resolve();
          });
        });
      }
      return next.state;
    });
    expect(lifecycle, "the new shell worker must install and activate").toBe("activated");
    await expect
      .poll(() => activeShellState(page, OFFLINE_MANIFEST_SHELL_VERSION, oldCache))
      .toEqual({
        version: OFFLINE_MANIFEST_SHELL_VERSION,
        shellCached: true,
        priorCachePresent: false,
      });

    // A fresh page under the new active worker decrypts the same snapshot and
    // queued event after the old shell cache has been removed.
    await context.setOffline(true);
    await page.reload();
    await openDeckDetails(page);
    await expect(page.getByText("No signal · device copy")).toBeVisible();
    await page.getByRole("button", { name: "After dive 1" }).click();
    await openDeckDetails(page);
    const preservedCrewRow = await savedPersonDetails(page, CAPTAIN_NAME);
    await expect(
      preservedCrewRow.getByRole("button", { name: "Aboard — tap again to undo" }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
    await context.unroute("**/manifest-sw.js", workerRoute);
  }
});

// story: ROLL-02
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
  await openDeckDetails(page);
  // Switch checkpoints before losing signal — the redirect should carry this
  // through so a captain mid roll call doesn't land back on "Before departure".
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  await openDeckDetails(page);

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

// story: ROLL-02
test("the offline fallback never reaches beyond the manifest route", async ({ page, context }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
  await waitForShellPrimed(page);

  // Move to a *different* trip surface — the worker's live-manifest pattern
  // is scoped to the manifest route alone and must not swallow this one too.
  // Gear, not Divers: the Trip page is the counter once arrivals open, and
  // the worker backs that one up on purpose (ADR
  // 20260907-the-counter-survives-offline; the next test).
  await openTripTab(page, "Prep");
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/prep$/);

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
  // and no concern of this spec; if the worker answered a legacy compatibility
  // URL, that
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

// story: ROLL-02
test("the live manifest response never enters Cache Storage", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
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
  const legacyRoster = await page.request.get(
    new URL("/api/offline-manifests/upcoming", page.url()).toString(),
  );
  expect(legacyRoster.status()).toBe(426);
  expect(legacyRoster.headers()["cache-control"]).toBe("private, no-store");
  expect(await legacyRoster.json()).toEqual({ error: "offline_update_required" });
  for (const path of ["/api/offline-manifests/upcoming", "/api/offline-manifests/identity"]) {
    const response = await page.request.get(new URL(path, page.url()).toString(), {
      headers: path.endsWith("/upcoming") ? ROLL_CALL_CAUSAL_HEADERS : undefined,
    });
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
  await openDeckDetails(page);
  await offlineCopySaved(page);

  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];
  // "after_dive_999" matches the checkpoint shape but doesn't exist on this
  // trip. Before validating against the saved trip's planned-dive count, the
  // manifest lookup silently fell back to departure's roster while the
  // heading and `isDeparture` still read the raw, nonexistent checkpoint —
  // showing one checkpoint's data under another's label.
  await page.goto(`/offline-manifest?trip=${tripId}&checkpoint=after_dive_999`);
  await expect(page.locator("[data-deck-screen]").getByText(/Before departure/)).toBeVisible();
});

/**
 * **A copy the worker opened because DiveDay was slow** (captain review B1,
 * 2026-10-23; re-review R1, R2). The worker swaps the saved copy in after four
 * silent seconds on a link that still reads online, and the header used to
 * call that copy "Online · Fresh copy · This copy is current". Playwright
 * cannot hold a worker's own fetch open, so this lands where the worker's
 * redirect lands, on the list, as the root path's does; `manifest-sw.test.ts`
 * covers the redirect itself. Once DiveDay answers, the copy offers the live
 * manifest and the captain chooses when: it never leaves on its own.
 */
test("a copy opened because DiveDay was slow says so from the list on, and offers the live manifest once it answers", async ({
  page,
  context,
}) => {
  // The board walk, then one live-manifest ask (five seconds) and the open.
  test.setTimeout(35_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
  await offlineCopySaved(page);
  const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\//)?.[1];

  await page.goto("/offline-manifest?fallback=slow");
  await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();

  await expect(page).toHaveURL(`/offline-manifest?trip=${tripId}&fallback=slow`);
  await expect(page.getByText(staff("shared.connectivity.unansweredWithCopy"))).toBeVisible();
  await openDeckDetails(page);
  await expect(page.getByText(/DiveDay didn’t answer, so this is the list/)).toBeVisible();
  // Under the roll call: who may be missing from this copy (issue #2980).
  await expect(page.getByText(/one removed still has one/)).toBeVisible();
  // Signal drops mid-count: the caveat stays, now asking for the count on the boat.
  await context.setOffline(true);
  await expect(page.getByText(/Count heads on the boat/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Fresh copy")).toHaveCount(0);
  await expect(page.getByText(staff("shared.connectivity.online"), { exact: true })).toHaveCount(0);
  // DiveDay answers this time: the copy says so and offers the live list,
  // and stays put until the captain takes the offer.
  // Reconnect verifies the tenant before remounting the saved trip. Its
  // native Details disclosure is closed again; await the attached recovery
  // message, then deliberately reopen it to take the offered live route.
  await page
    .locator(`p:text-is(${JSON.stringify(staff("shared.offlineManifest.single.liveAnswering"))})`)
    .waitFor({ state: "attached", timeout: 15_000 });
  await openDeckDetails(page);
  const offer = page
    .getByRole("status")
    .filter({ hasText: staff("shared.offlineManifest.single.liveAnswering") })
    .getByRole("link", {
      name: staff("shared.offlineManifest.single.openLiveManifest"),
      exact: true,
    });
  await expect(offer).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(`/offline-manifest?trip=${tripId}&fallback=slow`);
  await offer.click();
  await page.waitForURL((url) => url.pathname.endsWith(`/trips/${tripId}/manifest`));
  await expect(
    page
      .locator("#deck-flow h1")
      .getByRole("button", { name: staff("manifest.deck.home"), exact: true }),
  ).toBeVisible();
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
  // browser's offline error, listing every trip already saved. The redirect
  // names why (`fallback=failed`), and the list keeps that on the trip it
  // opens, so the trip screen knows it is the saved copy too.
  await expect(page).toHaveURL(/\/offline-manifest\?fallback=failed$/);
  await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toBeVisible();
  await page.getByText("Two-Tank Reef — Molasses & French").click();
  await expect(page).toHaveURL(/\/offline-manifest\?trip=[^&]+&fallback=failed$/);
  await openDeckDetails(page);
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(false);
});

// story: ROLL-04
test("a checkpoint with every diver counted stays open until the crew are called too", async ({
  page,
}) => {
  test.setTimeout(90_000); // Every named guest/crew record, two missing statements, a correction and a report.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
  await page.getByRole("link", { name: "After dive 1", exact: true }).click();
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);

  const guests = await deckPeople(page, "guest");
  const crew = await deckPeople(page, "crew");
  expect(guests.length).toBeGreaterThan(0);
  expect(crew.length).toBeGreaterThan(0);
  for (const name of guests) await recordDeckPerson(page, name);
  await expect(
    page.getByText(
      staff("manifest.deck.progress", { count: guests.length, total: guests.length + crew.length }),
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: staff("manifest.deck.home"), exact: true }).click();
  await expect(page.getByText(staff("manifest.deck.complete"), { exact: true })).toHaveCount(0);

  for (const name of crew) await recordDeckPerson(page, name);
  await page.getByRole("button", { name: staff("manifest.deck.home"), exact: true }).click();
  await expect(page.getByText(staff("manifest.deck.complete"), { exact: true })).toBeVisible();

  const firstName = guests[0];
  const firstDiverRow = await manifestRow(page, firstName);
  await openManifestPerson(firstDiverRow);
  const observation = "Surfaced 200 m north, picked up by Reef Runner at 14:31.";
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "What happened (optional)" })
    .first()
    .fill(observation);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark not back aboard", exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
    staff("manifest.deck.savedMissing"),
  );
  // A serious result persists in attention and names its person.
  await openDeckAttention(page);
  const progressPanel = page.locator('section[aria-labelledby="roll-call-progress-heading"]');
  await expect(progressPanel.getByText(/1 person is not back aboard/)).toBeVisible();
  const missingList = progressPanel.getByRole("list", { name: "Who is not back aboard" });
  // Each name opens that person on the roll call, sheet open (`DeckPersonChip`).
  await expect(missingList.getByRole("button")).toHaveCount(1);
  await expect(missingList.getByRole("button", { name: firstName, exact: true })).toBeVisible();

  await openManifestPerson(await manifestRow(page, firstName));
  const firstDiverDialog = page.getByRole("dialog");
  const startMissingReport = firstDiverDialog.getByRole("button", {
    name: /^Start a missing diver report — /,
  });
  await expect(startMissingReport).toBeVisible();
  await expect(firstDiverDialog.getByText(observation, { exact: true })).toBeVisible();
  // Withdraw the diver statement, then record a crew emergency while the guest remains uncalled.
  await firstDiverDialog.getByRole("button", { name: "Not back aboard", exact: true }).click();
  await expect(page.locator('[data-deck-screen="person"]')).toBeVisible();
  await expect(startMissingReport).toHaveCount(0);
  await openDeckPerson(page, crew[0]);
  await page.getByRole("button", { name: staff("manifest.deck.exception"), exact: true }).click();
  await openManifestPerson(page.locator("li[id^='crew-row-']").filter({ hasText: crew[0] }));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark not back aboard", exact: true })
    .click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
    staff("manifest.deck.savedMissing"),
  );
  await openDeckAttention(page);
  const awaitingEntry = progressPanel.locator("dl > div").filter({ hasText: "Awaiting" });
  await expect(progressPanel.getByText(/1 crew member is not back aboard/)).toBeVisible();
  await expect(awaitingEntry).toContainText("1");
  await expect(page.getByText(staff("manifest.deck.complete"), { exact: true })).toHaveCount(0);

  await openDeckPerson(page, crew[0]);
  await page.getByRole("button", { name: staff("manifest.deck.exception"), exact: true }).click();
  await openManifestPerson(page.locator("li[id^='crew-row-']").filter({ hasText: crew[0] }));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Start a missing diver report — / })
    .click();
  await expect(page).toHaveURL(
    /\/incidents\/[0-9a-f-]{36}\?from=manifest&checkpoint=after_dive_\d+$/,
  );
  await page.getByRole("link", { name: "Back to manifest" }).click();
  await expect(page).toHaveURL(/\/manifest\?checkpoint=after_dive_\d+$/);
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
  // blocks it — so it is covered by unit tests over `recordPushSubscription` and
  // `pushManifestChanged` instead.

  // Deny rather than grant: a page that requests permission unprompted would
  // still "work" against a granted context and hide the regression. With
  // notifications denied, any permission request on load is a silent failure —
  // and the control must still render its opt-in rather than an error.
  await context.clearPermissions();

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  // Behind the "On this phone" line since slice 5a: every per-device
  // preference is one tap away rather than standing at the foot of the boat
  // screen (ADR 20260827-the-departure-is-two-working-surfaces, decision 2).
  await openOnThisPhone(page);
  const optIn = page.getByRole("heading", { name: "Wake this phone" });
  await expect(optIn).toBeVisible();

  // The promise the copy makes is the one the feature can keep. "A ping can be
  // missed" is load-bearing: a captain who reads silence as
  // "nothing changed" is the failure mode this wording exists to prevent, and
  // an earlier draft ("so this phone carries the latest") invited exactly that.
  await expect(page.getByText(/A ping can be missed/)).toBeVisible();

  // Present, and off until someone taps it.
  await expect(page.getByRole("button", { name: "Notify this device" })).toBeVisible();
  await expect(
    page.getByText("This device gets a heads-up when the manifest changes near departure."),
  ).toHaveCount(0);

  // Nothing asked for permission merely by rendering the page: the prompt is
  // behind the button, because a denial on load cannot be retried from here.
  expect(await page.evaluate(() => Notification.permission)).not.toBe("granted");
});

test("the active checkpoint stays visible while selecting named Deck people", async ({ page }) => {
  // The individual Deck keeps checkpoint and progress visible while the captain navigates names.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}/manifest?checkpoint=after_dive_1`);
  for (const name of ["Tom Okafor", "Lena Fischer", "Diego Alvarez"]) {
    await openDeckPerson(page, name);
    await expect(
      page
        .locator('[data-deck-screen="person"]')
        .getByRole("link", { name: "After dive 1", exact: true }),
    ).toBeInViewport();
    await expect(page.getByText(/^0 of \d+ people accounted for$/)).toBeInViewport();
    await expect(
      page.getByRole("button", { name: staff("manifest.deck.record", { name }), exact: true }),
    ).toBeInViewport();
  }
});

// story: ROLL-01
test("resolving a blocker from the manifest lands on that diver, under the blocked filter", async ({
  page,
}) => {
  // Board → trip → Roll call → resolve-link navigation: four loads on the
  // 15s single-load default, still read-only.
  test.setTimeout(30_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  // Blockers and their one fix moved into the person's own panel (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 2 — clearing a
  // blocker is ashore work, not something the rail needs standing on the row).
  const blockedRow = await manifestRow(page, "Priya Sharma");
  await openManifestPerson(blockedRow);
  const resolve = page.getByRole("dialog").getByRole("link", { name: /Resolve/i });
  await expect(resolve).toBeVisible();
  const href = await resolve.getAttribute("href");
  const bookingAnchor = href?.split("#")[1];
  expect(bookingAnchor, "the resolve link must name the diver it is about").toBeTruthy();

  await resolve.click();
  // The remedy opens this guest’s folio with its outstanding requirements.
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+(?:\?booking=[^#]+)?#booking-/);
  await expect(
    page
      .locator("[data-guest-folios]")
      .getByRole("button", { name: "Priya Sharma", exact: true, expanded: true }),
  ).toBeVisible();

  // And actually scrolled to them: a `<Link>` transition does not run the
  // browser's own fragment scroll, so this used to land at the top of a page
  // of guest cards with the named diver far below the fold.
  const row = page.locator(`#${bookingAnchor}`);
  await expect(row).toBeInViewport();
});

test.describe("checklist configuration in a private shop", () => {
  // The privateShop fixture signs in as its minted owner. An inherited
  // canonical owner session would redirect /sign-in before that can happen.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an owner adds and removes a line on the shop's own pre-departure checklist", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/safety-checklist`);
    // The seeded demo shop's own list (src/db/seed/pre-departure-checklist.ts).
    await expect(page.getByText("VHF radio checked")).toBeVisible();
    await expect(page.getByLabel("New line")).not.toBeVisible();
    await page.locator("#checklist-new summary").click();
    await page.getByLabel("New line").fill("Test kit checked");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Added to the checklist")).toBeVisible();
    const newRow = page.getByRole("listitem").filter({ hasText: "Test kit checked" });
    await expect(newRow).toBeVisible();
    const ordered = page.getByRole("main").locator("ol").getByRole("listitem");
    await expect(ordered.first().getByRole("button", { name: "Move up" })).toBeDisabled();
    await expect(newRow.getByRole("button", { name: "Move down" })).toBeDisabled();
    const count = await ordered.count();
    await newRow.getByRole("button", { name: "Move up" }).click();
    await expect(ordered.nth(count - 2)).toContainText("Test kit checked");
    await expect(newRow.getByRole("button", { name: "Move down" })).toBeEnabled();

    await newRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Removed from the checklist")).toBeVisible();
    await expect(page.getByText("Test kit checked")).not.toBeVisible();
  });
});

test("a crew member checks a pre-departure item on the live manifest, and two re-taps undo it", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  await openBoatCheck(page);
  const item = page.getByRole("button", { name: "VHF radio checked" });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByText(/Checked by .* · /)).toBeVisible();

  // The same control is the undo (ADR 20260824-pre-departure-safety-check),
  // but clearing a safety item takes a second tap (#2481): the first only asks.
  await item.click();
  await expect(item).toContainText("Tap again to clear");
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await item.click();
  await expect(page.getByText(/Checked by .* · /)).not.toBeVisible();
});

// story: ROLL-07
test("a checklist tap made offline queues, then syncs once signal returns", async ({
  page,
  context,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  await offlineCopySaved(page);
  await openOnThisPhone(page);
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(
    page.getByText(staff("trips.offlineManifestManager.freshnessCurrent")),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await openDeckDetails(page);
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();

  // Only an *activated* worker catches the reload below. Neither the pill nor
  // the shell having rendered says its install has finished — under load the
  // reload otherwise reaches the network and fails ERR_INTERNET_DISCONNECTED.
  await waitForShellPrimed(page);
  await context.setOffline(true);
  await page.reload();
  await openDeckDetails(page);
  await expect(page.getByText("No signal · device copy")).toBeVisible();

  // The offline viewer, not the live manifest — its own surface, with the
  // checklist still standing open (slice 5a collapses the live manifest's).
  const item = page.getByRole("button", { name: "Fire extinguisher aboard and charged" });
  await item.click();
  await expect(
    page.getByRole("status").filter({ hasText: "when you’re back in service" }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(
    page
      .locator('[data-deck-screen] > [role="status"]')
      .getByText(staff("shared.offlineManifest.reconcile.allCaughtUp"), { exact: true }),
  ).toBeVisible();
});

/**
 * Issue #1018. Every refusal in `saveExecutedDiveAction` was a bare `return`,
 * so a divemaster who typed the exit time before the entry time (a
 * transposition — 14:35 in, 14:05 out, one-handed at the rail) saved nothing,
 * was told nothing, and got a form back holding the last saved row. The most
 * likely reading of that is that it saved, and what is written here is what an
 * incident export later seals into a document a physician reads.
 */
/**
 * **The shift catch-up strip** (issues #1202 and #1187, delight report D42 with
 * D27 folded in; ADR 20260904-reef-all-the-way-down slice 16d).
 *
 * The seed leaves the owner a read mark on today's reef boat stamped at 06:10
 * and the desk's own acts after it, so this is the state a staffer walking back
 * to a departure actually opens. What it proves is the rule's two silences —
 * nothing on a boat this reader has never opened, nothing once they have said
 * *Got it* — because a strip that reappears is a strip a crew learns to ignore.
 *
 * The third state, "an act that lands *after* Got it comes back", is pinned in
 * `src/db/trip-read-marks.test.ts`: producing one from the browser needs a second
 * actor, and this spec signs in as one person.
 */
test("the catch-up strip says what the desk did, and stops once the crew has read it", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  const strip = page.getByRole("region", { name: /Since you looked at/ });
  await expect(strip).toBeVisible();
  // Grouped by kind rather than replayed in order: two arrivals are one
  // sentence, and the meeting point is its own.
  await expect(strip).toContainText("have checked in.");
  await expect(strip).toContainText("The meeting point moved.");

  await strip.getByRole("button", { name: "Got it" }).click();
  await expect(strip).toHaveCount(0);

  // And it stays gone across a fresh render: the mark moved, so there is
  // nothing left to be "since".
  await page.reload();
  await page
    .locator("#deck-flow h1")
    .getByRole("button", { name: staff("manifest.deck.home"), exact: true })
    .waitFor();
  await expect(page.getByRole("region", { name: /Since you looked at/ })).toHaveCount(0);
});

test("a departure this staffer has never opened shows no catch-up at all", async ({ page }) => {
  // A first visit is reading, not catching up. With no read mark there is
  // nothing for a strip to be "since", and replaying the morning to somebody
  // seeing the boat for the first time is the surveillance feed #1202 refuses.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Wreck Trip — Spiegel Grove");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
  await page
    .locator("#deck-flow h1")
    .getByRole("button", { name: staff("manifest.deck.home"), exact: true })
    .waitFor();
  await expect(page.getByRole("region", { name: /Since you looked at/ })).toHaveCount(0);
});

test("the crew records why the plan changed, and the plan itself does not move", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  // At the dock the plan is read-only (issue #1184, D24). A change is said in
  // the dive log, at the checkpoint after the dive: the switch is the way
  // there, with no sentence under the plan pointing at it (UX audit
  // 2026-10-07, item 3).
  const planned = page.getByRole("heading", { name: "The plan" });
  await expect(planned).toBeVisible();
  await expect(page.getByText(/Changed the plan|Say why in the dive log/)).toHaveCount(0);
  // The dive log is written on the Trip page, On the water, beside the dive
  // (ADR 20261117-trip-page-clock): one form, one place.
  const tripId = tripIdFromUrl(page);
  const log = await openDiveLog(page, tripId);

  // A note with no reason above it is refused rather than dropped, and what
  // the divemaster typed survives the refusal (issue #1018's rule).
  await log.getByLabel("Actual site").fill("French Reef");
  await log.getByLabel("Note for the shop").fill("The mooring was taken.");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText(/Choose why the plan changed/).first()).toBeVisible();
  await expect(log.getByLabel("Note for the shop")).toHaveValue("The mooring was taken.");

  await log.getByLabel("Why the plan changed").selectOption("current");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();

  // The published plan is untouched: what happened lives in a different table.
  await page.goto(`/shop/blue-mantis/trips/${tripId}/manifest?checkpoint=departure`);
  await openDeckDetails(page);
  await expect(page.getByText("Dive 1 · Molasses Reef")).toBeVisible();
});

test("a transposed dive log entry is refused out loud and keeps what was typed", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  // The dive log is collapsed to a summary line (#1055), on the Trip page On
  // the water (ADR 20261117-trip-page-clock).
  const summary = page.locator("summary").filter({ hasText: "Dive 1" });
  const log = await openDiveLog(page, tripIdFromUrl(page));
  await expect(summary).toContainText("not recorded yet");
  await log.getByLabel("Entered the water").fill("14:35");
  await log.getByLabel("Exited the water").fill("14:05");
  await log.getByLabel(/Maximum depth/).fill("27");
  await log.getByRole("button", { name: "Save dive record" }).click();

  await expect(log.getByText(/exit time must be after the entry time/).first()).toBeVisible();
  // The whole point: nothing the divemaster entered is lost to the refusal.
  await expect(log.getByLabel("Entered the water")).toHaveValue("14:35");
  await expect(log.getByLabel("Exited the water")).toHaveValue("14:05");
  await expect(log.getByLabel(/Maximum depth/)).toHaveValue("27");

  // Correcting the one wrong field is all it takes.
  await log.getByLabel("Exited the water").fill("15:05");
  await log.getByRole("button", { name: "Save dive record" }).click();
  await expect(log.getByText("Dive record saved")).toBeVisible();
  // And the summary now states the record rather than its absence, which is
  // what the collapsed row is for.
  await expect(summary).not.toContainText("not recorded yet");
  await expect(summary).toContainText("27");
});

/**
 * **The counter with no signal** (ADR 20260907-the-counter-survives-offline).
 *
 * The desk is twenty metres from the rail and loses the same marina wifi, so
 * an arrival queues on the same device copy a head count does — and comes back
 * through the same round trip. Two things are proved here that no unit test
 * can: the tap works with the network cut, and the seat is genuinely checked
 * in on the live counter once signal returns.
 */
// story: ROLL-11
test("a counter check-in made offline queues, then syncs and lands on the live counter", async ({
  page,
  context,
}) => {
  // Nine server round trips before the tap even happens — board, trip,
  // manifest, the copy's save and refresh, the shell, a reload, then the sync
  // and the live counter afterwards. Same reasoning as the two long flows
  // above: the budget bounds a *stuck* test, and this one is simply long.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  const tripId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);

  await offlineCopySaved(page);
  await openOnThisPhone(page);
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(
    page.getByText(staff("trips.offlineManifestManager.freshnessCurrent")),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await openDeckDetails(page);
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();

  // Only an *activated* worker catches the reload below. Neither the pill nor
  // the shell having rendered says its install has finished — under load the
  // reload otherwise reaches the network and fails ERR_INTERNET_DISCONNECTED.
  await waitForShellPrimed(page);
  await context.setOffline(true);
  await page.reload();
  await openDeckDetails(page);
  await expect(page.getByText("No signal · device copy")).toBeVisible();

  const counter = page.getByRole("region", { name: "At the counter" });
  await expect(counter).toBeVisible();
  // Blocked divers get no control here, the same grammar the live counter
  // speaks: Priya's waiver has never been sent, so the row says what is in the
  // way instead of offering a tap the server would refuse on arrival.
  await expect(counter.getByRole("button", { name: /Priya Sharma/ })).toHaveCount(0);
  await expect(counter.getByText("Priya Sharma")).toBeVisible();

  // The row says which question it answers, in the live counter's own words —
  // the one thing that must not be ambiguous on a page whose other list boards
  // people.
  const diego = counter.getByRole("button", { name: /Diego Alvarez/ });
  await expect(diego).toContainText("Check in");
  await expect(diego).toHaveAttribute("aria-pressed", "false");
  await diego.click();
  await expect(diego).toHaveAttribute("aria-pressed", "true");
  await expect(diego).toContainText("Checked in");
  await expect(
    page.getByRole("status").filter({ hasText: "when you’re back in service" }),
  ).toBeVisible();

  // Nothing about a desk tap says anybody is on the boat: the roll call below
  // is untouched, and the arrival never becomes a boarding on reconnection.
  // The tile's label and figure are two elements, so this reads the figure
  // inside the tile the label names rather than one string spanning both.
  await expect(page.getByText(/^0 of \d+ people accounted for$/)).toBeVisible();
  await expect(diego).toContainText("Checked in");

  await context.setOffline(false);
  await expect(
    page
      .locator('[data-deck-screen] > [role="status"]')
      .getByText(staff("shared.offlineManifest.reconcile.allCaughtUp"), { exact: true }),
  ).toBeVisible();

  // The live counter opens this guest's folio with the persisted arrival and its Undo.
  await page.goto(counterPath("blue-mantis", tripId));
  const roster = await rosterRow(page, "Diego Alvarez");
  const arrival = roster.getByRole("button", { name: "Undo check-in for Diego Alvarez" });
  await expect(arrival).toBeVisible();
  await expect(arrival).toHaveText("Checked in");
  // And still nobody aboard — the desk closed the arrival and nothing else:
  // the group says "boarded" only once somebody has.
  await expect(roster.getByText(/boarded$/)).toHaveCount(0);
});

/**
 * The worker's second navigation fallback, scoped as narrowly as the first: a
 * staffer who reloads the counter with no signal lands on the saved copy of
 * the departure they were working, not the browser's offline error.
 */
// story: ROLL-11
test("a failed reload of the counter lands on this device's saved copy", async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  const tripUrl = new URL(page.url());
  const tripId = tripUrl.pathname.split("/").at(-1) ?? "";
  await openTripTab(page, "Manifest");
  await openDeckDetails(page);
  await waitForShellPrimed(page);

  await page.goto(counterPath("blue-mantis", tripId));
  await expect(page.getByText(/^\d+ of \d+ here\b/)).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  // The redirect carries the focus across, so the copy that opens is the boat
  // the staffer was working rather than the device-wide list, and says why the
  // worker opened it (`fallback=failed`: the request failed, offline).
  await expect(page).toHaveURL(new RegExp(`/offline-manifest\\?trip=${tripId}&fallback=failed$`));
  await openDeckDetails(page);
  await expect(page.getByRole("region", { name: "At the counter" })).toBeVisible();
});

/**
 * Issue #2960: every staffer sees the chip; the departure's crew opens the
 * words, and the read is on the diver's trail. The seeded alert is on
 * tomorrow's crewed departure (`src/db/seed/medical-alert.ts`).
 */
// story: ROLL-08
test("a departure's crew opens a diver's medical alert, and the read is on their trail", async ({
  page,
  browser,
  workerBaseURL,
  staffStorageState,
}) => {
  // Three staffers, each opening the manifest and a person sheet.
  test.slow();
  const staff = staffTranslator("en-US");
  const openAlertSheet = async (viewer: Page) => {
    await viewer.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(viewer, DEMO_MEDICAL_ALERT_TRIP);
    await openTripTab(viewer, "Manifest");
    const row = await manifestRow(viewer, DEMO_MEDICAL_ALERT_DIVER);
    await expect(row.getByText(staff("manifest.medicalAlertChip"), { exact: true })).toBeVisible();
    await openManifestPerson(row);
    const sheet = viewer.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: staff("manifest.medicalAlertHeading") }),
    ).toBeVisible();
    return sheet;
  };

  // An instructor who is not on this departure's crew: the fact, and who can read it.
  const instructorContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: await staffStorageState("instructor"),
  });
  try {
    const instructor = makeActivitySafe(await instructorContext.newPage());
    const sheet = await openAlertSheet(instructor);
    await expect(sheet.getByText(staff("manifest.medicalAlertReaders"))).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: staff("manifest.medicalAlertShow"), exact: true }),
    ).toHaveCount(0);
    // The day before, the emergency offer is already there and the server
    // says it opens on the day of the trip (domain review 2, S1).
    await sheet.getByRole("button", { name: staff("manifest.medicalAlertEmergencyOffer") }).click();
    await sheet
      .getByRole("button", { name: staff("manifest.medicalAlertEmergencyConfirm") })
      .click();
    await expect(sheet.getByText(staff("manifest.medicalAlertEmergencyNotYet"))).toBeVisible();
    await expect(sheet.getByText(DEMO_MEDICAL_ALERT)).toHaveCount(0);
  } finally {
    await instructorContext.close();
  }

  // A divemaster on the crew: the words, behind a tap that says it is noted.
  const crewContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: await staffStorageState("divemaster"),
  });
  try {
    const crew = makeActivitySafe(await crewContext.newPage());
    const sheet = await openAlertSheet(crew);
    await expect(sheet.getByText(DEMO_MEDICAL_ALERT)).toHaveCount(0);
    await expect(sheet.getByText(staff("manifest.medicalAlertShowHint"))).toBeVisible();
    await sheet.getByRole("button", { name: staff("manifest.medicalAlertShow") }).click();
    await expect(sheet.getByText(DEMO_MEDICAL_ALERT)).toBeVisible();
    await expect(sheet.getByText(staff("manifest.medicalAlertNotReviewed"))).toBeVisible();
  } finally {
    await crewContext.close();
  }

  // The owner finds the read on the diver's trail.
  await page.goto(`/shop/blue-mantis/divers?q=${encodeURIComponent(DEMO_MEDICAL_ALERT_DIVER)}`);
  await page.getByRole("link", { name: DEMO_MEDICAL_ALERT_DIVER, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: DEMO_MEDICAL_ALERT_DIVER }),
  ).toBeVisible();
  const trail = await openDiverFileGroup(page, staff("divers.activity.heading"));
  await expect(trail.getByText(`read ${DEMO_MEDICAL_ALERT_DIVER}’s medical alert`)).toBeVisible();
});

/** The owner finds `line` on `diverName`'s trail. */
async function onDiverTrail(page: Page, diverName: string, line: string) {
  await page.goto(`/shop/blue-mantis/divers?q=${encodeURIComponent(diverName)}`);
  await page.getByRole("link", { name: diverName, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();
  const trail = await openDiverFileGroup(page, staff("divers.activity.heading"));
  await expect(trail.getByText(line).first()).toBeVisible();
}

/**
 * Issue #2990, part 1: the owner prints the packet with the medical alerts'
 * words under each row, for a crew whose phone is dead at sea; the print is on the diver's trail.
 */
// story: ROLL-08
test("an owner prints the packet with the medical alerts, and the print is on the diver's trail", async ({
  page,
}) => {
  // Two packet renders and a diver record.
  test.slow();
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, DEMO_MEDICAL_ALERT_TRIP);
  await openTripAbout(page);
  const tripPath = new URL(page.url()).pathname;

  const choice = page.getByRole("button", { name: staff("trips.about.printPacket") });
  await expect(choice).toHaveCount(1);
  const popupPromise = page.waitForEvent("popup");
  await choice.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveURL(new RegExp(`${tripPath}\\?print=1$`));
  await popup.emulateMedia({ media: "print" });
  await expect(popup.getByText(DEMO_MEDICAL_ALERT)).toBeVisible();
  await expect(
    popup.getByRole("heading", { level: 1, name: staff("manifest.medicalAlertsPrintedTitle") }),
  ).toBeVisible();
  await expect(popup.getByText(staff("manifest.medicalAlertsPrintedKeep"))).toBeVisible();
  await expect(popup.getByText(staff("manifest.medicalAlertNotReviewed"))).toBeVisible();
  // The words are for the sheet, never the tab left open after the dialog
  // closes (layer 4 security review, note 1).
  await popup.emulateMedia({ media: "screen" });
  await expect(popup.getByText(DEMO_MEDICAL_ALERT)).toBeHidden();
  await popup.close();

  await onDiverTrail(
    page,
    DEMO_MEDICAL_ALERT_DIVER,
    `printed ${DEMO_MEDICAL_ALERT_DIVER}’s medical alert`,
  );
});

/**
 * Issue #2990, part 2: on the day of the departure, an instructor the crew
 * rule refuses opens a diver's alert in an emergency, behind a confirm step,
 * and the owner finds the read on the diver's trail.
 */
// story: ROLL-08
test("an instructor off the crew opens a medical alert in an emergency today, and the read is on the diver's trail", async ({
  page,
  browser,
  workerBaseURL,
  staffStorageState,
}) => {
  // A held send, a signing, and two staffers' manifests.
  test.slow();
  const diver = diverTranslator("en-US");
  const ALERT = "Asthma. Inhaler in the dry box.";

  // A diver on today's departure writes an alert and signs.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
  await openTripTab(page, "Trip");
  const row = await openFirstRosterRowWith(page, "Send waiver");
  const diverName = await openedGuestName(page);
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();
  // The diver signs on the thread link the request carried (issue #2743); the
  // helper waits out the held send before it reads the link.
  const waiverHref = await waiverRequestLinkAfterSend(page, row);
  await page.goto(waiverHref);
  const medicalNo = page.locator("#medical-questionnaire").getByRole("radio", { name: "No" });
  await medicalNo.first().waitFor();
  const count = await medicalNo.count();
  for (let i = 0; i < count; i++) await medicalNo.nth(i).check();
  await page.getByLabel(diver("waiver.medicalAlertLabel")).fill(ALERT);
  await page.getByLabel("Type your full name").fill(diverName);
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expectSignedOnThread(page);

  const instructorContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: await staffStorageState("instructor"),
  });
  try {
    const instructor = makeActivitySafe(await instructorContext.newPage());
    await instructor.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(instructor, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(instructor, "Manifest");
    const entry = await manifestRow(instructor, diverName);
    await expect(
      entry.getByText(staff("manifest.medicalAlertChip"), { exact: true }),
    ).toBeVisible();
    await openManifestPerson(entry);
    const sheet = instructor.getByRole("dialog");
    // Refused by the crew rule: who can read it, and the emergency door.
    await expect(sheet.getByText(staff("manifest.medicalAlertReaders"))).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: staff("manifest.medicalAlertShow"), exact: true }),
    ).toHaveCount(0);
    await sheet.getByRole("button", { name: staff("manifest.medicalAlertEmergencyOffer") }).click();
    await expect(sheet.getByText(staff("manifest.medicalAlertEmergencyConfirmBody"))).toBeVisible();
    await expect(sheet.getByText(ALERT)).toHaveCount(0);
    await sheet
      .getByRole("button", { name: staff("manifest.medicalAlertEmergencyConfirm") })
      .click();
    await expect(sheet.getByText(ALERT)).toBeVisible();
    await expect(sheet.getByText(staff("manifest.medicalAlertNotReviewed"))).toBeVisible();
  } finally {
    await instructorContext.close();
  }

  await onDiverTrail(page, diverName, `opened ${diverName}’s medical alert in an emergency`);
});
