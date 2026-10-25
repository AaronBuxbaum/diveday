import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

signedInAsOwner();
const staff = staffTranslator("en-US");

async function catalogCamera(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(
      (candidate) => candidate.startsWith("diveday:map:") && candidate.endsWith(":catalog"),
    );
    return key
      ? (JSON.parse(sessionStorage.getItem(key) ?? "null") as {
          latitude: number;
          longitude: number;
          zoom: number;
        } | null)
      : null;
  });
}

async function markerPositions(page: Page) {
  return page.locator(".leaflet-container").evaluate((map) => {
    const bounds = map.getBoundingClientRect();
    return Array.from(map.querySelectorAll(".leaflet-site-marker button, .leaflet-site-cluster"))
      .map((marker) => {
        const point = marker.getBoundingClientRect();
        return [
          marker.getAttribute("aria-label"),
          Math.round(point.x - bounds.x),
          Math.round(point.y - bounds.y),
        ];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  });
}

/** The library map with its first standalone pin, named, once the marker layer is still. */
async function firstLibraryPin(page: Page) {
  await page.clock.install({ time: E2E_FROZEN_CLOCK });
  await page.goto("/shop/blue-mantis/dive-sites");
  await waitForMarkerLayer(page);
  const pin = page.locator(".leaflet-site-marker button").first();
  const name = await pin.getAttribute("aria-label");
  if (!name) throw new Error("Site marker has no name");
  return { pin, name };
}

test("a standalone site's hover label names it at a readable width", async ({ page }) => {
  const { pin, name } = await firstLibraryPin(page);
  await pin.hover();
  const tooltip = page.locator(".leaflet-site-tooltip");
  await expect(tooltip).toContainText(name);
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox?.width).toBeGreaterThan(100);
  expect(tooltipBox?.width).toBeLessThanOrEqual(260);
});

test("a standalone site opens immediately and closing its card clears selection", async ({
  page,
}) => {
  const { pin, name } = await firstLibraryPin(page);
  await pin.click();
  const popup = page.locator(".leaflet-site-popup");
  await expect(popup).toHaveCount(1);
  await expect(popup.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".leaflet-site-marker button.ring-4")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".leaflet-shop-marker [role=img]").evaluate((shop) => {
        const map = shop.closest(".leaflet-container");
        if (!map) throw new Error("Dive center is outside the map");
        const bounds = map.getBoundingClientRect();
        // A shop whose spot the card panned off the map is not drawn at all.
        if (!shop.checkVisibility()) return 0;
        const marker = shop.getBoundingClientRect();
        return Math.min(
          marker.left - bounds.left,
          marker.top - bounds.top,
          bounds.right - marker.right,
          bounds.bottom - marker.bottom,
        );
      }),
    )
    .toBeGreaterThanOrEqual(0);
  const open = popup.getByRole("link", { name: staff("diveSites.map.openSite") });
  await open.hover();
  expect(await open.evaluate((link) => getComputedStyle(link).textDecorationLine)).toBe("none");
  const close = popup.getByRole("button", { name: "Close popup" });
  const closeGeometry = await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const glyph = button.querySelector("span");
    const glyphBox = glyph?.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      radius: Number.parseFloat(getComputedStyle(button).borderRadius),
      verticalOffset: glyphBox
        ? Math.abs(glyphBox.y + glyphBox.height / 2 - box.y - box.height / 2)
        : 0,
    };
  });
  expect(closeGeometry.width).toBe(closeGeometry.height);
  expect(closeGeometry.radius).toBeGreaterThanOrEqual(closeGeometry.width / 2);
  expect(closeGeometry.verticalOffset).toBeLessThanOrEqual(1);
  await close.click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator(".leaflet-site-marker button.ring-4")).toHaveCount(0);
});

test("the dive center stays separate and identifies itself without opening a popup", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/dive-sites?view=catalog");
  await waitForMarkerLayer(page);
  const shop = page.locator(".leaflet-shop-marker [role=img]");
  await expect(shop).toHaveAccessibleName("Blue Mantis Divers");
  await shop.hover();
  await expect(page.locator(".leaflet-site-tooltip")).toContainText("Blue Mantis Divers");
  await shop.click();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await shop.focus();
  await shop.press("Enter");
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  const cluster = page.locator(".leaflet-site-cluster").first();
  await expect(cluster).toBeVisible();
  const before = await markerPositions(page);
  await cluster.click();
  await expect.poll(() => markerPositions(page)).not.toEqual(before);
  await expect(shop).toHaveCount(1);
});

type Camera = { latitude: number; longitude: number; zoom: number };

/**
 * The map is ready to be read: Leaflet drew its controls and attribution, the
 * marker layer drew its pins or clusters, and no zoom animation is running.
 * The first visible cluster alone is not that: it can appear before Leaflet's
 * controls, and a click then waits on a control that is not there yet.
 */
async function waitForMarkerLayer(page: Page) {
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".leaflet-control-zoom-out")).toBeVisible();
  await expect(map.locator(".leaflet-control-attribution")).toBeAttached();
  await expect(
    map.locator(".leaflet-site-marker button, button.leaflet-site-cluster").first(),
  ).toBeVisible();
  // Leaflet puts the animation class on its map pane, not its outer container.
  await expect(map.locator(".leaflet-zoom-anim")).toHaveCount(0);
  // The overview fit and the clustering that follows it redraw the markers; a
  // hover or a read taken mid-redraw lands on a pin that is about to be
  // replaced. The layer is still once two reads in a row agree.
  let last = await markerPositions(page);
  await expect
    .poll(async () => {
      const now = await markerPositions(page);
      const still = JSON.stringify(now) === JSON.stringify(last);
      last = now;
      return still;
    })
    .toBe(true);
}

/**
 * The same camera, read back. A restored camera is re-projected through
 * Leaflet's pixel grid, so its centre comes back a few billionths of a degree
 * off the one stored: equal to the metre, never bit for bit (the failure this
 * spec had on CI: the same zoom, latitude and longitude differing past the
 * sixth decimal).
 */
function sameCamera(camera: Camera) {
  return {
    zoom: camera.zoom,
    latitude: expect.closeTo(camera.latitude, 6),
    longitude: expect.closeTo(camera.longitude, 6),
  };
}

/** How far, in whole pixels, the markers sit from where they were: the same names, at most a pixel of rounding. */
async function markerDrift(page: Page, before: (string | number | null)[][]) {
  const now = await markerPositions(page);
  if (now.length !== before.length) return Number.POSITIVE_INFINITY;
  let drift = 0;
  for (const [index, [name, x, y]] of now.entries()) {
    const [beforeName, beforeX, beforeY] = before[index];
    if (name !== beforeName) return Number.POSITIVE_INFINITY;
    drift = Math.max(
      drift,
      Math.abs(Number(x) - Number(beforeX)),
      Math.abs(Number(y) - Number(beforeY)),
    );
  }
  return drift;
}

/**
 * The catalog's second page, zoomed out one step by the reader: the camera a
 * template preview must hand back. Returns the stored camera and where the
 * markers sat under it.
 */
async function zoomOutOnTheCatalog(page: Page) {
  await page.clock.install({ time: E2E_FROZEN_CLOCK });
  await page.goto("/shop/blue-mantis/dive-sites?view=catalog&page=2");
  await waitForMarkerLayer(page);
  const overview = await markerPositions(page);
  // The overview is the map's own fit, not a camera anyone set: nothing is kept.
  expect(await catalogCamera(page)).toBeNull();
  await page
    .locator(".leaflet-container")
    .getByRole("button", { name: "Zoom out", exact: true })
    .click();
  // The stored camera is written on moveend, which Leaflet fires once the zoom
  // has ended, so the first camera stored is the settled one.
  await expect.poll(() => catalogCamera(page)).not.toBeNull();
  await waitForMarkerLayer(page);
  await expect.poll(() => markerPositions(page)).not.toEqual(overview);
  const saved = (await catalogCamera(page)) as Camera;
  return { saved, markers: await markerPositions(page) };
}

/** Opens the first template's preview and proves its title names the site. */
async function previewFirstTemplate(page: Page) {
  const preview = page.locator('[id^="template-row-"]').getByRole("link").first();
  const siteName = await preview.getAttribute("aria-label");
  if (!siteName) throw new Error("Template preview has no name");
  await preview.click();
  await page.waitForURL(/page=2&template=/);
  await expect(page).toHaveTitle(`${siteName} — DiveDay`);
  await expect(
    page.getByRole("button", { name: staff("diveSites.catalog.importToLibrary") }),
  ).toBeVisible();
}

test("browser back from a template preview restores the catalog camera", async ({ page }) => {
  const { saved, markers } = await zoomOutOnTheCatalog(page);
  await expect(
    page.getByRole("button", { name: staff("diveSites.catalog.importToLibrary") }),
  ).toHaveCount(0);
  await previewFirstTemplate(page);
  await page.goBack();
  await waitForMarkerLayer(page);
  await expect.poll(() => catalogCamera(page)).toEqual(sameCamera(saved));
  await expect.poll(() => markerDrift(page, markers)).toBeLessThanOrEqual(1);
});

test("All templates from a template preview restores the catalog camera", async ({ page }) => {
  const { saved, markers } = await zoomOutOnTheCatalog(page);
  await previewFirstTemplate(page);
  await page.getByRole("link", { name: staff("diveSites.catalog.backToCatalog") }).click();
  await page.waitForURL(/view=catalog&page=2$/);
  await waitForMarkerLayer(page);
  await expect.poll(() => catalogCamera(page)).toEqual(sameCamera(saved));
  await expect.poll(() => markerDrift(page, markers)).toBeLessThanOrEqual(1);
});
