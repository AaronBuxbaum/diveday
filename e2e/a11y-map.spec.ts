import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DIVE_SITE_TEMPLATES } from "../src/content/dive-site-templates";
import { expectNoA11yViolations } from "./a11y-scan";
import { expect, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

signedInAsOwner();

async function expectMapSiteCount(page: Page, count: number) {
  await expect
    .poll(() =>
      page.locator(".leaflet-marker-pane").evaluate((pane) => {
        const pins = pane.querySelectorAll(".leaflet-site-marker button").length;
        const clustered = [...pane.querySelectorAll("button.leaflet-site-cluster")].reduce(
          (sum, cluster) => sum + Number(cluster.textContent),
          0,
        );
        return pins + clustered;
      }),
    )
    .toBe(count);
}

async function overlapNativePinPair(page: Page) {
  const markers = page.locator(".leaflet-site-marker");
  await expect(markers.nth(1).locator("button")).toBeVisible();
  // Keep real Leaflet pin buttons and their intrinsic sizes. Deliberately
  // overlap this pair to exercise the geographic spacing exception even
  // though the production cluster layout now separates resting targets.
  await markers.evaluateAll((nodes) => {
    const map = nodes[0]?.closest(".leaflet-container");
    if (!map) throw new Error("Site map did not mount");
    const bounds = map.getBoundingClientRect();
    for (const [index, marker] of nodes.slice(0, 2).entries()) {
      if (!(marker instanceof HTMLElement)) throw new Error("Site marker is not an HTML element");
      const position = marker.getBoundingClientRect();
      marker.style.left = `${bounds.left + 120 + index * 12 - position.left}px`;
      marker.style.top = `${bounds.top + 180 - position.top}px`;
      marker.style.zIndex = String(index);
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/shop/blue-mantis/dive-sites");
  await expect(page.locator(".leaflet-site-marker button").first()).toBeVisible();
  await expectMapSiteCount(page, 8);
});

test("essential geographic pin spacing keeps every other accessibility check", async ({ page }) => {
  await overlapNativePinPair(page);
  await page
    .locator(".leaflet-site-marker button")
    .first()
    .evaluate((pin) => {
      pin.id = "essential-spacing-pin";
    });
  const raw = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
  expect(
    raw.violations.some(
      (violation) =>
        violation.id === "target-size" &&
        violation.nodes.some((node) => node.target.includes("#essential-spacing-pin")),
    ),
  ).toBe(true);
  await expectNoA11yViolations(page);
  await page.goto("/shop/blue-mantis/dive-sites/catalog");
  await expect(page.locator("button.leaflet-site-cluster").first()).toBeVisible();
  await expectMapSiteCount(
    page,
    DIVE_SITE_TEMPLATES.filter(
      ({ briefing }) => briefing.forecastLatitude != null && briefing.forecastLongitude != null,
    ).length,
  );
  await expectNoA11yViolations(page);
  const details = page
    .locator('[id^="template-row-"]')
    .getByRole("link", { name: "Molasses Reef", exact: true });
  await expect(details).toBeVisible();
  const bounds = await details.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await details.click({ position: { x: 24, y: 20 } });
  await page.waitForURL(/template=molasses-reef/);
  await expect(page.getByRole("heading", { name: "Molasses Reef", exact: true })).toBeVisible();
});

test("an ordinary undersized button still fails target-size", async ({ page }) => {
  await page.evaluate(() => {
    const group = document.createElement("div");
    group.style.cssText = "position:fixed;left:0;top:0;z-index:10000;display:flex";
    for (const id of ["ordinary-small-target", "ordinary-small-neighbor"]) {
      const button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.setAttribute("aria-label", id);
      button.style.cssText = "width:16px;height:16px;padding:0;border:0";
      group.append(button);
    }
    document.body.append(group);
  });
  await expect(page.locator("#ordinary-small-target")).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("ordinary-small-target");
});

test("an undersized map zoom control still fails target-size", async ({ page }) => {
  const zoom = page.locator(".leaflet-control-zoom-in");
  await zoom.evaluate((control) => {
    control.id = "zoom-small-target";
    Object.assign(control.style, { width: "28px", height: "28px" });
    const neighbor = control.nextElementSibling;
    if (neighbor instanceof HTMLElement) {
      Object.assign(neighbor.style, {
        position: "absolute",
        left: "0",
        top: "14px",
        width: "28px",
        height: "28px",
      });
    }
  });
  await expect(zoom).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("zoom-small-target");
});

test("an undersized popup control still fails target-size", async ({ page }) => {
  // Leaflet's native auto-pan measures elapsed Date time.
  await page.clock.install({ time: E2E_FROZEN_CLOCK });
  await page.locator(".leaflet-site-marker button").first().press("Enter");
  await expect(page.locator(".leaflet-site-marker button.ring-4")).toHaveCount(1);
  await expect(page.locator(".leaflet-popup-content")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".leaflet-site-popup").evaluate((popup) => {
        const map = popup.closest(".leaflet-container");
        if (!map) return Number.NEGATIVE_INFINITY;
        const card = popup.getBoundingClientRect();
        const bounds = map.getBoundingClientRect();
        return Math.min(
          card.left - bounds.left,
          card.top - bounds.top,
          bounds.right - card.right,
          bounds.bottom - card.bottom,
        );
      }),
    )
    .toBeGreaterThanOrEqual(0);
  const close = page.getByRole("button", { name: "Close popup" });
  await close.evaluate((control) => {
    control.id = "popup-small-target";
    Object.assign(control.style, { width: "16px", height: "16px" });
    const neighbor = document.createElement("button");
    neighbor.type = "button";
    neighbor.setAttribute("aria-label", "Popup neighbor");
    neighbor.style.cssText = "position:absolute;right:16px;top:0;width:16px;height:16px;padding:0";
    control.parentElement?.append(neighbor);
  });
  await close.scrollIntoViewIfNeeded();
  await expect(close).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("popup-small-target");
});

test("a map pin with no accessible name still fails button-name", async ({ page }) => {
  await page
    .locator(".leaflet-site-marker button")
    .first()
    .evaluate((pin) => {
      pin.removeAttribute("aria-label");
    });
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
});

test("an intrinsically undersized geographic pin still fails target-size", async ({ page }) => {
  await overlapNativePinPair(page);
  const pin = page.locator(".leaflet-site-marker button").first();
  await pin.evaluate((button) => {
    button.id = "tiny-pin-target";
    Object.assign(button.style, { width: "16px", height: "16px" });
  });
  await expect(pin).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("tiny-pin-target");
});
