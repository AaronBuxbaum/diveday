/**
 * Visual captures: the command palette, the not-found page and the staff surfaces read in Spanish.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { staffPassengerCount } from "../src/i18n/participant-labels";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { manifestRow, openManifestPerson, openOnThisPhone } from "./helpers";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  openReefTrip,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  settleOfflineShellWorker,
  staffCopy,
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

      /**
       * The staff command palette and the app's not-found backstop — surfaces
       * that are *states*, not routes, and so had no baseline at all.
       *
       * The palette is hosted on `/settings/calendar` rather than Today. It is
       * `position: fixed`, and a `fullPage` shot renders a fixed element once,
       * at the top, above however much page happens to sit underneath — so
       * hosting it on the tall dashboard would bank a baseline that re-diffs
       * every time Today's queue changes, for a change that has nothing to do
       * with the overlay. The calendar settings page is the shortest read-only
       * staff surface there is (two panels, no seeded rows, nothing minted
       * until a button is pressed), so almost all of the image is the overlay
       * itself.
       *
       * It closes its overlay before finishing: an overlay left open leaks
       * into whatever the same page does next.
       */
      // The command palette on open, with no query typed: a Client Component,
      // so wait for the control it only renders once mounted *and* focused
      // rather than for anything the server rendered. An empty query lists
      // every "Go to" destination the registry offers this role — no search
      // request, nothing debounced, nothing that could land differently
      // between runs.
      test(`the command palette renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        // The keypress is lost if it lands before the palette's listener is
        // attached; the fixture's `goto` waits for its trigger to say it is
        // (issue #2366, `settleStaffHydration` in e2e/fixtures.ts).
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await capture(page, "command-palette", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      // The same panel with results in it, which is the half no baseline had:
      // searched groups draw their own glyph in the same rail as the "Go to"
      // rows (issue #773), and only a query shows them. Waits for a real
      // option rather than for the request — the input is debounced, so the
      // rendered row is the only honest signal that the answer landed.
      test(`the command palette with results renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        // The keypress is lost if it lands before the palette's listener is
        // attached; the fixture's `goto` waits for its trigger to say it is
        // (issue #2366, `settleStaffHydration` in e2e/fixtures.ts).
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await box.fill("reef");
        await expect(page.getByRole("option", { name: /Reef/ }).first()).toBeVisible();
        await capture(page, "command-palette-results", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      test(`the command palette with a failed search renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.route("**/api/search?q=zz-unavailable", (route) =>
          route.fulfill({ status: 503, body: "" }),
        );
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByRole("combobox", { name: /Search divers/ }).fill("zz-unavailable");
        await expect(
          page.getByRole("button", { name: staffCopy("shared.commandPalette.retry"), exact: true }),
        ).toBeVisible();
        await capture(page, "command-palette-search-failed", scheme);
      });

      // The app-wide `notFound()` backstop (src/app/not-found.tsx) — a stale
      // email link or a typo'd URL. Captured under a staff session because
      // that is who reaches it on a `/shop` URL; signed out the same address
      // is an auth redirect, never this page.
      test(`the not-found page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/no-such-page");
        await page.getByRole("heading", { level: 1, name: "We couldn’t find that page" }).waitFor();
        await capture(page, "not-found", scheme);
      });

      /**
       * **Four dense surfaces, read in Spanish** (issues #1681, #2407).
       *
       * Every other capture in this file signs in with an English reader, so no
       * baseline had ever seen an `es-ES` string in a layout — in a product
       * whose Spanish is systematically longer and whose word choices are
       * recorded and guarded (`src/i18n/locales/es-ES/README.md`). What no
       * check held was whether the chosen word *fits*.
       *
       * Four, not everything: the surfaces where length is most likely to
       * break something are the dense fixed-width ones, and these are the four
       * reviews have pointed at. Each costs four screenshots and a triage
       * burden on every future pull request, which is why the set is named here
       * rather than derived.
       *
       * One block, because `test.use` is describe-scoped — so these sit
       * together instead of beside their English siblings, which is the one
       * place this file's "one surface, one test" layout bends.
       *
       * The phone width is the one that matters. Every finding these are here
       * to catch is a string that fits at 1280 and does not at 390.
       */
      test.describe("read in Spanish", () => {
        test.use({ locale: SPANISH });

        test(`a mixed-passenger departure log reads in Spanish without clipping (${scheme})`, async ({
          page,
          request,
        }) => {
          const seeded = await request.post("/api/test/seed-trouble-states?mixedBoat=1");
          expect(seeded.ok()).toBe(true);
          const { mixedBoat } = (await seeded.json()) as { mixedBoat?: { tripId: string } };
          if (!mixedBoat) throw new Error("seed-trouble-states found no departure to mix");

          const copy = staffTranslator(SPANISH);
          await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}/log`);
          await page
            .getByRole("heading", { name: copy("incidentExport.timelineHeading") })
            .waitFor();
          const passengerTotal = await page
            .locator('section[aria-labelledby="incident-roster-heading"] tbody tr')
            .count();
          expect(passengerTotal).toBeGreaterThan(2);
          const passengerTile = page
            .locator('section[aria-labelledby="incident-summary-heading"] dl > div')
            .filter({ has: page.getByText(copy("incidentExport.summaryDivers"), { exact: true }) });
          const figure = passengerTile.locator("dd");
          expect(await figure.evaluate((value) => value.firstChild?.textContent?.trim())).toBe(
            String(passengerTotal),
          );
          await expect(figure.locator("span")).toHaveText(
            String(
              staffPassengerCount(copy, {
                totalDivers: passengerTotal,
                byType: { diver: passengerTotal - 2, snorkeler: 1, rider: 1 },
              }),
            ),
          );
          await capture(page, "departure-log-participant-types", scheme, {
            locale: SPANISH,
            beforeShot: async () => {
              const fits = await passengerTile.evaluate(async (tile) => {
                await document.fonts.ready;
                const value = tile.querySelector("dd");
                const detail = value?.querySelector("span");
                if (!value || !detail) return false;
                const bounds = tile.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(detail);
                return (
                  value.scrollWidth <= value.clientWidth &&
                  [...range.getClientRects()].every(
                    (rect) => rect.left >= bounds.left && rect.right <= bounds.right,
                  )
                );
              });
              expect(fits, "the complete passenger breakdown fits within its tile").toBe(true);
            },
          });
        });

        /**
         * **The offline roll call in Spanish**: each saved row's one status
         * line (visual review 2026-10-24, B01), whose words used to ride in
         * chips, and the one "Por embarcar: {count}" line that replaced the
         * face grid (B02). Spanish runs longer than English on every one of
         * them, so this is the baseline that shows the lines wrap rather
         * than clip. It is also the only one of the three whose Spanish does
         * not come from a request at all: this view renders offline from
         * IndexedDB and reads `navigator.language`.
         */
        test(`the offline roll call reads in Spanish (${scheme})`, async ({ page }) => {
          // Board → trip → Manifest, then the saved copy. By URL, which is
          // also what `openTripTab` does now that the departure has no tab
          // strip; spelling it here keeps the flow readable as a URL walk.
          test.setTimeout(FLOW_TIMEOUT_MS);
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await settleOfflineShellWorker(page);
          await openOnThisPhone(page);
          await page.getByRole("link", { name: "Abrir pase de lista sin conexión" }).click();
          await page.waitForURL(/offline-manifest/);
          await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
          // The still-to-board line under the roll call: the roster above it
          // renders first, so a wait on a diver's name is not a wait on this.
          await expect(page.getByRole("link", { name: /^Por embarcar: / })).toBeVisible();
          await capture(page, "offline-manifest-roll-call", scheme, { locale: SPANISH });
        });

        /**
         * **The manifest's checkpoint track**, whose tabs carry a checkpoint
         * name and a state word in a row that has to stay one line: "Punto de
         * control activo" against "Active checkpoint", and "No embarcado"
         * against "Not boarded" on every row's control.
         */
        test(`a trip's manifest reads in Spanish (${scheme})`, async ({ page }) => {
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
          // The same background save the English sibling waits out, in this
          // reader's words: `offlineCopySaved` matches "(Fresh|Aging|Stale)
          // copy" and would wait forever here. These are the manifest
          // manager's own words (`trips.offlineManifestManager.freshness*`),
          // which is what this page renders — not the offline viewer's "Copia
          // reciente / antigua / caducada" (`shared.offlineManifest.
          // freshnessPill.*`), a different surface saying the same thing at a
          // different URL.
          await expect(
            page.getByText(/Copia (actualizada|envejeciendo|desactualizada)/),
          ).toBeVisible();
          // The track, not the page: it is what this capture is for, and the
          // heading above it is true before the checkpoints render.
          await expect(page.getByText("Punto de control activo").first()).toBeVisible();
          await capture(page, "manifest", scheme, { locale: SPANISH });
        });

        /**
         * **The after-dive buddy alert, in Spanish** (#2407). "Compañero sin
         * regresar a bordo" was measured by hand at about 229px against the
         * roughly 246px capsule line a phone gives it; this is the baseline
         * that holds it there. The same state as the English
         * `manifest-buddy-divergence`: Tom aboard, his teammate Lena recorded
         * not back.
         */
        test(`the manifest's split buddy team reads in Spanish (${scheme})`, async ({ page }) => {
          test.setTimeout(FLOW_TIMEOUT_MS);
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await expect(
            page.getByText(/Copia (actualizada|envejeciendo|desactualizada)/),
          ).toBeVisible();
          await page
            .getByRole("link", { name: "Después de la inmersión 1" })
            .evaluate((link: HTMLElement) => link.click());
          await page.waitForURL(/checkpoint=after_dive_1/);
          const tomRow = manifestRow(page, "Tom Okafor");
          const lenaRow = manifestRow(page, "Lena Fischer");
          const boardTom = tomRow.getByRole("button", { name: "Marcar embarcado" });
          await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
          await boardTom.click();
          await openManifestPerson(lenaRow);
          const dialog = page.getByRole("dialog");
          const lenaNotBack = dialog.getByRole("button", { name: "Marcar sin regresar a bordo" });
          await lenaNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
          await lenaNotBack.click();
          await expect(
            dialog.getByRole("button", { name: "Sin regresar a bordo", exact: true }),
          ).toBeVisible();
          await dialog.getByRole("button", { name: "Cerrar detalles de la persona" }).click();
          await expect(tomRow.getByText("Lena sin regresar a bordo")).toBeVisible();
          await page.mouse.move(0, 0);
          await capture(page, "manifest-buddy-divergence", scheme, { locale: SPANISH });
        });

        /**
         * **The staffing week's gap chips**, two words in English ("No
         * divemaster") and two in Spanish ("Sin divemaster") inside a day
         * cell whose width is a seventh of the grid.
         *
         * Through the same trouble-states route its English sibling uses: a
         * demo shop permanently short-handed is a worse demo.
         */
        test(`the staffing week's crew gap reads in Spanish (${scheme})`, async ({
          page,
          request,
        }) => {
          await request.post("/api/test/seed-trouble-states?crewGap=1");
          await page.goto("/shop/blue-mantis/staffing");
          await page.getByText("Sin divemaster").first().waitFor();
          await capture(page, "staffing-week-gap", scheme, { locale: SPANISH });
        });
      });
    });
  });
}
