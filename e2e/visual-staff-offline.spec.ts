/**
 * Visual captures: the offline manifest and counter.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openOnThisPhone, openTripTab } from "./helpers";
import {
  AGING_SAVED_AT,
  capture,
  FLOW_TIMEOUT_MS,
  IDENTITY_ROUTE,
  installVisualBuildGuard,
  OTHER_SHOP,
  openReefTrip,
  PAST_PENDING_GRACE,
  rewriteSavedOfflineRecord,
  SURFACE_TIMEOUT_MS,
  savedOfflineRecordFor,
  settleOfflineShellWorker,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("staff", () => {
      signedInAsOwner();

      // The offline shell's list view — every trip currently saved on this
      // device, reachable at dive.day root as well as `/offline-manifest`
      // directly (see ADR 20260726-shopwide-offline-manifest-priming). Visiting
      // the manifest is what puts a trip in it, so this test walks there first.
      test(`the offline manifest list renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the offline shell.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await settleOfflineShellWorker(page);
        await page.goto("/offline-manifest");
        await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
        await capture(page, "offline-manifest-list", scheme);
      });

      test(`the saved list says when DiveDay did not answer (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await settleOfflineShellWorker(page);
        await page.goto("/offline-manifest?fallback=slow");
        await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
        await expect(
          page.getByText(
            staffTranslator("en-US")("shared.offlineManifest.single.unansweredBanner"),
          ),
        ).toBeVisible();
        await capture(page, "offline-manifest-list-unanswered", scheme);
      });

      /**
       * The same list with one copy no longer current — the only state on it
       * that carries a pill at all.
       *
       * The baseline above photographs the calm case, where every row is
       * current and nothing is badged; before 2026-08-23 that case badged all
       * four rows green and this one was indistinguishable from it at a glance
       * (issue #816). That is the whole reason this frame exists separately:
       * the change is only worth anything if the exceptional row is louder than
       * the ordinary ones, and no capture could show that while they looked the
       * same. Both the row's pill and the group line at the top move here and
       * nowhere else.
       */
      test(`an offline copy needing a refresh renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { savedAt: AGING_SAVED_AT });
        // The tenant lookup is still refused from `savedOfflineRecordFor`, so
        // no cross-shop purge re-reads the record underneath this reload and
        // the row paints from exactly what was just written.
        await page.reload();
        await page.getByText("Saved 2 hours ago").waitFor();
        await capture(page, "offline-manifest-list-needs-refresh", scheme);
      });

      /**
       * The saved copy actually *opened* — the roll call a crew member works
       * with no signal, which until now had no baseline of any kind. The four
       * other offline captures photograph the shell's states around it (the
       * list, nothing-saved, discarded, another shop's), and none of them
       * contains a diver row, so every control on the surface a boat falls back
       * to was uncovered: the roster, the per-diver note disclosure, the
       * board/not-boarded pair, the freshness pill. Found by a 2026-08-11 change
       * that restyled the note disclosure here and moved no pixels in any
       * baseline.
       */
      test(`the offline roll call renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the saved copy.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        // The roster is what proves the record was read back and decrypted —
        // the shell renders its chrome before the store resolves.
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await capture(page, "offline-manifest-roll-call", scheme);
        await page.getByRole("link", { name: "Roll call", exact: true }).click();
        await expect(page.locator("#offline-roll-call-context")).toBeFocused();
        await capture(page, "offline-manifest-roll-call-jump", scheme);
        await page
          .getByRole("link", {
            name: staffTranslator("en-US")("manifest.emergency.heading"),
            exact: true,
          })
          .click();
        await expect(page.locator("#offline-emergency-reference")).toBeFocused();
      });

      /**
       * **The saved copy the worker opened because DiveDay did not answer**
       * (captain review B1, 2026-10-23). Online, and saved a moment ago, so
       * the ordinary header would read "Online · Fresh copy · This copy is
       * current"; this one says DiveDay did not answer and when the copy was
       * saved. The live manifest is held silent so the shell's own ask does
       * not bring up the offer before the first frame; then it answers, and
       * the second frame is the offer (re-review R1).
       */
      test(`an offline copy opened for a silent DiveDay renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await settleOfflineShellWorker(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
        await page.route(
          (url) => url.pathname.endsWith("/manifest") && url.pathname.includes("/trips/"),
          () => {},
        );
        await page.goto(`/offline-manifest?trip=${tripId}&fallback=slow`);
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await expect(page.getByText("No answer · device copy")).toBeVisible();
        await capture(page, "offline-manifest-unanswered", scheme);

        await page.unrouteAll();
        await expect(
          page.getByRole("status").filter({ hasText: "DiveDay is answering again." }),
        ).toBeVisible({
          timeout: 15_000,
        });
        await capture(page, "offline-manifest-live-answering", scheme);
      });

      /**
       * **The same saved copy after a dive, with nothing recorded yet** — the
       * ordinary opening of a surface-interval count at sea. "Mark not back
       * aboard" is neutral on every row until somebody records it, as on the
       * live page (decision 4 of ADR 20260827-the-departure-is-two-working-
       * surfaces, issue #2107). The frame above is the departure checkpoint,
       * whose controls were already neutral, so nothing photographed this one.
       */
      test(`the offline after-dive roll call renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await page.getByRole("button", { name: "After dive 1" }).click();
        await expect(page.getByRole("heading", { name: "After dive 1 roll call" })).toBeVisible();
        await capture(page, "offline-manifest-after-dive", scheme);
      });

      /**
       * **The counter's own half of that copy, with a tap made** (ADR
       * 20260907-the-counter-survives-offline).
       *
       * The frame above photographs the section untouched, alongside every
       * other control on the shell. This one is the state a desk actually
       * works in: one seat settled — the primary fill and the drawn check the
       * live counter's own settled row wears — beside a diver readiness
       * refuses, who gets no control at all and shows what is in the way. Two
       * rows that must not look alike, and nothing else on this surface can
       * show that pair.
       */
      test(`the offline counter renders a settled arrival true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, then the saved copy, then one tap.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        const counter = page.getByRole("region", { name: "At the counter" });
        const diego = counter.getByRole("button", { name: /Diego Alvarez/ });
        await diego.click();
        // Wait on what the tap itself renders, never on a timeout: the row
        // reports its own settled state through `aria-pressed`.
        await expect(diego).toHaveAttribute("aria-pressed", "true");
        await capture(page, "offline-counter-settled", scheme, {
          beforeShot: async () => {
            const name = counter.getByText("Diego Alvarez", { exact: true });
            await expect(name).toBeVisible();
            expect(
              await name.evaluate(
                (element) =>
                  element.scrollWidth <= element.clientWidth &&
                  getComputedStyle(element).textOverflow !== "ellipsis",
              ),
            ).toBe(true);
            await expect(diego).toHaveAttribute("aria-pressed", "true");
          },
        });
      });

      // The offline fallback a captain lands on after a failed reload with
      // no snapshot saved — the entire safety surface in that moment, so it
      // gets its own baseline rather than relying on the roll-call text
      // assertion in e2e/manifest.spec.ts to catch a styling regression.
      // Staff pages prime a device copy in the background, so clear IndexedDB
      // immediately before the visit to reproduce the truly-empty state (e.g.
      // storage eviction) rather than assuming a fresh context is enough.
      test(`the empty offline manifest renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // The shop-wide primer (OfflineManifestAutoSave) starts a fetch →
        // purge → save-all round on every staff page mount, and its parallel
        // saves can land *after* the deleteDatabase below finishes — the
        // store quietly refills and the empty heading never renders (caught
        // as a 164s timeout on CI shard 2, run 31075399016). Cut the race at
        // the harness boundary: with the upcoming-manifests feed blocked
        // from the first navigation, no round ever writes, and the delete
        // stays as defence against any other writer.
        await page.route("**/api/offline-manifests/upcoming", (route) => route.abort());
        await openReefTrip(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase("diveday-offline-manifests");
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error ?? new Error("failed to clear IndexedDB"));
            }),
        );
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Nothing saved on this phone yet" }).waitFor();
        await capture(page, "offline-manifest-empty", scheme);
      });

      /**
       * The discard notice: roll call a crew member recorded offline that never
       * reached DiveDay, on a saved copy the store finally deleted for passing
       * `OFFLINE_MANIFEST_PENDING_GRACE_MS` — 28 days past its own expiry — with
       * that evidence still queued on it (security review 2026-08-06, F3).
       *
       * It earns a baseline because of *where* it lands and *when*. The delete
       * almost always happens with no page open (the worker's push refresh, the
       * staff layout's auto-save), so this danger-toned panel is the first and
       * only place a human is told; and the surface it appears on is a shared
       * boat tablet at the dock, in the minute a captain is counting heads. It
       * is also the one thing on this shell that reconnecting cannot undo.
       *
       * Captured on the **list** branch, once. The notice is a single component
       * rendered identically by all three branches (list, the trip empty state,
       * and the roster) — the only difference is which sibling precedes it — so
       * a second and third frame would cost eight more PNGs to photograph the
       * same markup at a different vertical offset. The list is where a tablet
       * picked up at the dock opens.
       *
       * Left on Blue Mantis's own record rather than a foreign shop's: the
       * ceiling is shop-agnostic, and keeping it on the seeded shop means every
       * word in the notice is a seeded value rather than an invented one.
       */
      test(`the offline manifest's discard notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        // Two divers' worth, so the plural of both strings is what is banked —
        // one lost tap is the rarer shape, and it is the narrower one to lay out.
        await rewriteSavedOfflineRecord(page, tripId, {
          expiresAt: PAST_PENDING_GRACE,
          pendingRollCalls: 2,
        });

        // The tenant lookup stays refused for the rest of this test (see
        // `savedOfflineRecordFor`), and here that is what makes the panel
        // deterministic rather than merely still. A tenant the shell *can*
        // resolve starts a cross-shop purge, and that purge reads every saved
        // record through `loadOfflineManifest` — the same function the list
        // branch is already reading them through. Both would reach this record
        // before either deleted it, both would append a notice for it, and the
        // panel would photograph one row or two depending on which finished
        // first. One reader, one row.
        await page.reload();
        // The notice itself, not the list heading: the discard is written while
        // the store is being read and the panel arrives after the rows, so the
        // heading resolves against a page that has not yet been told anything
        // was lost. `role="alert"` is the panel's own element — waiting on the
        // "Got it" button would equally prove it mounted, but this is the
        // sentence a regression would move.
        await page
          .getByRole("alert")
          .filter({
            hasText: staffTranslator("en-US")("shared.offlineManifest.discarded.heading"),
          })
          .waitFor();
        await capture(page, "offline-manifest-discarded", scheme);
      });

      /**
       * `?trip=<id>` for a record the cross-shop purge has just deleted out from
       * under the captain reading it — a different shop signed in on this
       * tablet, so this trip's saved copy is gone and roll call for it has to be
       * recorded on that shop's own live manifest (security review 2026-08-06,
       * F5).
       *
       * The point of the state is the *copy*: before this it repainted to the
       * ordinary "Nothing saved on this phone yet", which is the one sentence
       * the captain already knows is false — they were looking at the roster a
       * moment ago. `offline-manifest-empty` is the baseline for that ordinary
       * sentence and stays pointed at it; this is its own frame because the two
       * render the same layout with different words, and a regression that
       * collapsed one into the other would move nothing on that one.
       *
       * Reached the way it happens on a boat, in order: no signal, so the shell
       * paints the saved roster; then signal, so the purge runs and the record
       * goes. That order is the whole test — the state needs the roster to have
       * been on screen first (it is what tells the purge whose copy it was
       * removing), so a purge that wins the race to the store instead produces
       * the plain empty state and photographs the wrong page.
       */
      test(`an offline copy removed by another shop renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { shop: OTHER_SHOP });

        // No signal for the first paint — the tenant lookup is still refused
        // from `savedOfflineRecordFor`, so the purge declines to run and the
        // saved roster paints from storage exactly as it does on the dock.
        // Cutting the whole context offline would say the same thing, and would
        // also put this navigation through the service worker's cached shell:
        // a second thing to prime and a second thing to be flaky.
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Before departure roll call" }).waitFor();

        // Signal returns. The shell re-runs its purge on `online` — the same
        // event the fixture's own `setOffline(false)` dispatches — and this time
        // the tenant answers, so the foreign record is deleted and the branch
        // repaints saying why.
        await page.unroute(IDENTITY_ROUTE);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page
          .getByRole("heading", {
            name: staffTranslator("en-US")("shared.offlineManifest.single.removedOtherShopHeading"),
          })
          .waitFor();
        await capture(page, "offline-manifest-removed-other-shop", scheme);
      });
    });
  });
}
