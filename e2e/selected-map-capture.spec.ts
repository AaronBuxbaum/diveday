import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  mapIsReady,
  waitForMapTilesToSettle,
  waitForSelectedMapToSettle,
} from "./selected-map-capture";
import { E2E_FROZEN_CLOCK } from "./servers";
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
    page.evaluate(mapIsReady, true),
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

test("map readiness rejects zooming on the pane Leaflet actually animates", async ({ page }) => {
  await renderSelectedMap(page);
  await page.locator("img").evaluate((tile) => {
    tile.style.opacity = "1";
  });
  await page.locator(".leaflet-map-pane").evaluate((pane) => {
    pane.classList.add("leaflet-zoom-anim");
  });
  expect(await readiness(page)).toBe(false);
});

for (const [name, wait] of [
  ["selected", waitForSelectedMapToSettle],
  ["tooltip", waitForMapTilesToSettle],
] as const) {
  for (const clock of ["frozen", "advancing"] as const) {
    test(`${name} map wait polls the resolved readiness boolean with ${clock} clock`, async ({
      page,
    }) => {
      if (clock === "advancing") await page.clock.install({ time: E2E_FROZEN_CLOCK });
      await renderSelectedMap(page);
      if (name === "tooltip") {
        await page.locator(".leaflet-popup").evaluate((popup) => popup.remove());
        await page.locator("button").evaluate((marker) => marker.classList.remove("ring-4"));
      }
      let sampled!: () => void;
      const firstSample = new Promise<void>((resolve) => {
        sampled = resolve;
      });
      // Observe a completed predicate call, whether it runs through the old
      // waitForFunction path or the driver-side evaluate path. No elapsed-time guess.
      const originals = {
        evaluate: page.evaluate,
        waitForFunction: page.waitForFunction,
      };
      for (const method of ["evaluate", "waitForFunction"] as const) {
        Object.defineProperty(page, method, {
          configurable: true,
          value: (...args: unknown[]) => {
            const work = Reflect.apply(originals[method], page, args) as Promise<unknown>;
            if (args[0] === mapIsReady) void work.then(sampled, () => undefined);
            return work;
          },
        });
      }
      let settled = false;
      const pending = wait(page).then(() => {
        settled = true;
      });
      void pending.catch(() => undefined);
      try {
        await Promise.race([firstSample, pending]);
        await expect(page.locator("img")).toHaveCSS("opacity", "0");
        expect(settled, "a Promise resolving false must not count as a ready map").toBe(false);
        await page.locator("img").evaluate((tile) => {
          tile.style.opacity = "1";
        });
        await pending;
        expect(settled).toBe(true);
      } finally {
        try {
          await page.locator("img").evaluate((tile) => {
            tile.style.opacity = "1";
          });
          await pending.catch(() => undefined);
        } finally {
          for (const method of ["evaluate", "waitForFunction"] as const) {
            Object.defineProperty(page, method, {
              configurable: true,
              writable: true,
              value: originals[method],
            });
          }
        }
      }
    });
  }
}

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

test("tooltip map readiness requires opaque tiles without requiring a selected popup", async ({
  page,
}) => {
  await renderSelectedMap(page);
  await page.locator(".leaflet-popup").evaluate((popup) => popup.remove());
  await page.locator("button").evaluate((marker) => marker.classList.remove("ring-4"));
  const ready = () =>
    withRendererBound(
      page,
      "tooltip map readiness regression",
      15_000,
      page.evaluate(mapIsReady, false),
      false,
    );
  expect(await ready()).toBe(false);
  await page.locator("img").evaluate((tile) => {
    tile.style.opacity = "0.5";
  });
  expect(await ready()).toBe(false);
  await page.locator("img").evaluate((tile) => {
    tile.style.opacity = "1";
  });
  expect(await ready()).toBe(true);
  // The selected-popup contract must not silently become the weaker tooltip one.
  expect(await readiness(page)).toBe(false);
  await page
    .locator(".leaflet-map-pane")
    .evaluate((pane) => pane.classList.add("leaflet-pan-anim"));
  expect(await ready()).toBe(false);
});
