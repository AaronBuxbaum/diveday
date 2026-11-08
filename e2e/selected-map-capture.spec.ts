import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { selectedMapIsReady, waitForSelectedMapToSettle } from "./selected-map-capture";
import { capture, withRendererBound } from "./visual-harness";

async function renderSelectedMap(page: Page) {
  await page.setContent(`
    <div class="leaflet-container"><div class="leaflet-map-pane">
      <div class="leaflet-site-marker"><button class="ring-4">Site</button></div>
      <div class="leaflet-popup">Selected site</div>
      <img class="leaflet-tile leaflet-tile-loaded" style="opacity:0"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'/%3E">
    </div></div>`);
  await page.locator("img").evaluate((tile: HTMLImageElement) => tile.decode());
}

const readiness = (page: Page) =>
  withRendererBound(
    page,
    "map readiness regression",
    15_000,
    page.evaluate(selectedMapIsReady),
    false,
  );

test("selected map readiness rejects loaded tiles until their fade has finished", async ({
  page,
}) => {
  await renderSelectedMap(page);
  expect(await readiness(page)).toBe(false);
  await page.locator("img").evaluate((tile) => {
    tile.style.opacity = "1";
  });
  expect(await readiness(page)).toBe(true);
  await page
    .locator(".leaflet-map-pane")
    .evaluate((pane) => pane.classList.add("leaflet-pan-anim"));
  expect(await readiness(page)).toBe(false);
});

test("selected map readiness is checked again after document painting", async ({ page }) => {
  await renderSelectedMap(page);
  await withRendererBound(
    page,
    "install paint-induced pending tile",
    15_000,
    page.evaluate(() => {
      const tile = document.querySelector<HTMLImageElement>("img");
      if (!tile) throw new Error("Tile fixture is missing");
      tile.style.opacity = "1";
      const scroll = window.scrollTo;
      window.scrollTo = (...args: unknown[]) => {
        document.documentElement.dataset.paintScrolled = "true";
        tile.style.opacity = "0";
        Reflect.apply(scroll, window, args);
      };
    }),
    undefined,
  );
  await expect(
    capture(page, "selected-map-readiness-regression", "dark", {
      beforeShot: async () => {
        expect(await readiness(page)).toBe(true);
      },
      beforeScreenshot: async () => {
        await expect(page.locator("html")).toHaveAttribute("data-paint-scrolled", "true");
        expect(await readiness(page)).toBe(false);
        // Release the pending tile only after the paint pass has exposed it.
        await page.locator("img").evaluate((tile) => {
          tile.style.opacity = "1";
        });
        await waitForSelectedMapToSettle(page);
        throw new Error("Settled after paint, before shutter");
      },
    }),
  ).rejects.toThrow("Settled after paint, before shutter");
});
