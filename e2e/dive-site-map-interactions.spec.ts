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

test("a standalone site opens immediately and closing its card clears selection", async ({
  page,
}) => {
  await page.clock.install({ time: E2E_FROZEN_CLOCK });
  await page.goto("/shop/blue-mantis/dive-sites");
  const pin = page.locator(".leaflet-site-marker button").first();
  await expect(pin).toBeVisible();
  const name = await pin.getAttribute("aria-label");
  if (!name) throw new Error("Site marker has no name");
  await pin.hover();
  const tooltip = page.locator(".leaflet-site-tooltip");
  await expect(tooltip).toContainText(name);
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox?.width).toBeGreaterThan(100);
  expect(tooltipBox?.width).toBeLessThanOrEqual(260);
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

test("browser back and All templates restore the camera while preview titles name the site", async ({
  page,
}) => {
  await page.clock.install({ time: E2E_FROZEN_CLOCK });
  await page.goto("/shop/blue-mantis/dive-sites?view=catalog&page=2");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".leaflet-site-cluster").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: staff("diveSites.catalog.importToLibrary") }),
  ).toHaveCount(0);
  const overview = await markerPositions(page);
  // The overview is the map's own fit, not a camera anyone set: nothing is kept.
  expect(await catalogCamera(page)).toBeNull();
  await map.getByRole("button", { name: "Zoom out", exact: true }).click();
  // The stored camera is written on moveend, after Leaflet's rAF zoom begins and ends.
  // A class-absence check alone can pass before that first animation frame.
  await expect.poll(() => catalogCamera(page)).not.toBeNull();
  // Leaflet puts the animation class on its map pane, not its outer container.
  // Reading marker coordinates during that transform captures an intermediate camera.
  await expect(map.locator(".leaflet-zoom-anim")).toHaveCount(0);
  await expect.poll(() => markerPositions(page)).not.toEqual(overview);
  const camera = await markerPositions(page);
  const savedCamera = await catalogCamera(page);
  const preview = page.locator('[id^="template-row-"]').getByRole("link").first();
  const siteName = await preview.getAttribute("aria-label");
  if (!siteName) throw new Error("Template preview has no name");
  await preview.click();
  await page.waitForURL(/page=2&template=/);
  await expect(page).toHaveTitle(`${siteName} — DiveDay`);
  await expect(
    page.getByRole("button", { name: staff("diveSites.catalog.importToLibrary") }),
  ).toBeVisible();
  await page.goBack();
  await expect(map.locator(".leaflet-site-cluster").first()).toBeVisible();
  await expect.poll(() => catalogCamera(page)).toEqual(savedCamera);
  await expect.poll(() => markerPositions(page)).toEqual(camera);
  await preview.click();
  await page.waitForURL(/page=2&template=/);
  await page.getByRole("link", { name: staff("diveSites.catalog.backToCatalog") }).click();
  await page.waitForURL(/view=catalog&page=2$/);
  await expect.poll(() => catalogCamera(page)).toEqual(savedCamera);
  await expect.poll(() => markerPositions(page)).toEqual(camera);
});
