/**
 * Visual captures: the dive-site library and catalog.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";
import {
  CATALOG_MAP_SITE_COUNT,
  capture,
  expectOverviewMapSites,
  expectPopupInMap,
  installVisualBuildGuard,
  openStandaloneLibraryMapPin,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
  waitForSiteLibrary,
  waitForSiteMap,
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

      // The shop's own dive-site library, which had no baseline at all until
      // it gained a search band and a pager. One grouped ledger since ADR
      // 20260827-the-shops-shelves — difficulty groups easiest first, the
      // requirement words on the rows that carry one, and the DiveDay catalog
      // as the quiet door at its tail.
      test(`the dive-site library renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await waitForSiteLibrary(page);
        // Leaflet measures pan progress with Date; let its animation clock
        // advance from the harness instant while this case changes map sizes.
        await page.clock.install({ time: E2E_FROZEN_CLOCK });
        await capture(page, "dive-sites-library", scheme, {
          beforeShot: () => expectOverviewMapSites(page, 8),
        });

        // Use a real standalone pin from this viewport; a cluster's count
        // does not identify which named sites it contains.
        await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
        const firstPin = page.locator(".leaflet-site-marker button").first();
        await expect(firstPin).toBeVisible();
        const pinName = await firstPin.getAttribute("aria-label");
        if (!pinName) throw new Error("Site marker has no accessible name");
        const mapPin = page
          .locator(".leaflet-site-marker")
          .getByRole("button", { name: pinName, exact: true });
        await expect(mapPin).toBeVisible();
        await mapPin.hover();
        await expect(page.locator(".leaflet-site-tooltip")).toContainText(pinName);
        const pinBox = await mapPin.boundingBox();
        const mapBox = await page.locator(".leaflet-container").boundingBox();
        const viewport = page.viewportSize();
        if (!pinBox || !mapBox || !viewport) throw new Error("Map target has no viewport bounds");
        expect(pinBox.x).toBeGreaterThanOrEqual(Math.max(0, mapBox.x));
        expect(pinBox.y).toBeGreaterThanOrEqual(Math.max(0, mapBox.y));
        expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(
          Math.min(viewport.width, mapBox.x + mapBox.width),
        );
        expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(
          Math.min(viewport.height, mapBox.y + mapBox.height),
        );
        const scrollBeforePinSelection = await page.evaluate(() => window.scrollY);
        // The target is fully visible; use physical input so this assertion
        // measures selection without the driver's ancestor-scroll preparation.
        await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
        await expect(mapPin).toHaveClass(/ring-4/);
        const selectedPopup = page
          .locator(".leaflet-site-popup")
          .filter({ has: page.getByRole("heading", { name: pinName, exact: true }) })
          .last();
        await expect(selectedPopup).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforePinSelection);
        const waitForSelectedMapToSettle = () =>
          page.waitForFunction(
            async () => {
              const map = document.querySelector<HTMLElement>(".leaflet-container");
              const pane = map?.querySelector<HTMLElement>(".leaflet-map-pane");
              const marker = map?.querySelector<HTMLElement>(".leaflet-site-marker button.ring-4");
              const popup = map?.querySelector<HTMLElement>(".leaflet-popup");
              if (!map || !pane || !marker || !popup) return false;

              const geometry = () => {
                const rect = (element: HTMLElement) => {
                  const { x, y, width, height } = element.getBoundingClientRect();
                  return [x, y, width, height];
                };
                return [pane.style.transform, rect(marker), rect(popup)];
              };
              const nextFrame = () =>
                new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              await nextFrame();
              const before = geometry();
              await nextFrame();
              const after = geometry();
              const tilesIdle =
                map.querySelector(".leaflet-tile:not(.leaflet-tile-loaded)") === null;

              return (
                !pane.classList.contains("leaflet-pan-anim") &&
                tilesIdle &&
                JSON.stringify(before) === JSON.stringify(after)
              );
            },
            undefined,
            { timeout: 15_000 },
          );
        let footerFocusedAtPreviousWidth = false;
        await capture(page, "dive-sites-library-pin-selected", scheme, {
          beforeShot: async () => {
            await waitForSelectedMapToSettle();
            await expectPopupInMap(page, selectedPopup);
            for (const selector of [
              ".leaflet-site-card__title",
              ".leaflet-site-card__fact",
              ".leaflet-site-card__link",
            ]) {
              const decisionText = selectedPopup.locator(selector);
              await expect(decisionText.first()).toBeVisible();
              const sizes = await decisionText.evaluateAll((nodes) =>
                nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
              );
              for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
            }
            const footer = selectedPopup.locator(".leaflet-site-card__link");
            await expect
              .poll(async () => (await footer.boundingBox())?.height ?? 0)
              .toBeGreaterThanOrEqual(44);
            if (footerFocusedAtPreviousWidth) await expect(footer).toBeFocused();
            await selectedPopup.locator(".leaflet-popup-close-button").focus();
            await page.keyboard.press("Shift+Tab");
            await expect(footer).toBeFocused();
            expect(
              await footer.evaluate((link) => {
                const style = getComputedStyle(link);
                return link.matches(":focus-visible") && Number.parseFloat(style.outlineWidth) > 0;
              }),
            ).toBe(true);
            footerFocusedAtPreviousWidth = true;
            await expectPopupInMap(page, selectedPopup);
          },
        });
        await expect(selectedPopup.locator(".leaflet-site-card__link")).toBeFocused();
        // The card pans the map toward the map's edge. Where that takes the
        // shop's own spot off the map, the shop is not drawn at all rather than
        // pinned to the edge (Aaron, 2026-10-23); where it does not, it stays.
        await capture(page, "dive-sites-library-site-card-edge", scheme, {
          beforeShot: async () => {
            await expectPopupInMap(page, selectedPopup);
          },
        });
      });

      test(`dive-site map labels stay readable on hover and focus (${scheme})`, async ({
        page,
      }) => {
        await page.clock.install({ time: E2E_FROZEN_CLOCK });
        await page.goto("/shop/blue-mantis/dive-sites");
        await waitForSiteLibrary(page);
        await capture(page, "dive-sites-library-shop-tooltip", scheme, {
          beforeScreenshot: async () => {
            const shop = page.locator(".leaflet-shop-marker [role=img]");
            await expect(shop).toBeVisible();
            await page.mouse.move(0, 0);
            await shop.focus();
            await shop.hover();
            await expect(page.locator(".leaflet-site-tooltip")).toHaveCount(1);
            await expect(page.locator(".leaflet-site-tooltip")).toContainText("Blue Mantis Divers");
          },
        });
        await capture(page, "dive-sites-library-pin-tooltip", scheme, {
          beforeShot: async () => {
            await waitForSiteMap(page);
          },
          beforeScreenshot: async () => {
            // The phone overview can contain only clusters. Open one just as
            // a person would, after the paint scroll has settled map sizing.
            const pin = await openStandaloneLibraryMapPin(page);
            await expect(pin).toBeVisible();
            const name = await pin.getAttribute("aria-label");
            if (!name) throw new Error("Site marker has no accessible name");
            await page.mouse.move(0, 0);
            await pin.focus();
            await pin.hover();
            const tooltips = page.locator(".leaflet-site-tooltip");
            await expect(tooltips).toHaveCount(1);
            await expect(tooltips.filter({ hasText: name })).toBeVisible();
          },
        });
      });

      // DiveDay's published dive-site templates, in the same ledger grammar as
      // the library they feed (ADR 20260827-the-shops-shelves): the row is the
      // preview door; import lives on the preview itself. It is the
      // library's own catalog *view* rather than a route of its own
      // (ADR 20260806-dive-site-catalog-is-a-view), so this opens the view
      // directly and keeps the `dive-sites-catalog` capture name.
      test(`the dive-site catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites?view=catalog");
        await page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }).waitFor();
        await waitForSiteMap(page);
        await capture(page, "dive-sites-catalog", scheme, {
          beforeShot: () => expectOverviewMapSites(page, CATALOG_MAP_SITE_COUNT),
        });
      });
    });
  });
}
