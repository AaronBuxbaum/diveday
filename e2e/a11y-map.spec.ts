import AxeBuilder from "@axe-core/playwright";
import { expectNoA11yViolations } from "./a11y-scan";
import { expect, test } from "./fixtures";

test.beforeEach(async ({ page, privateShop }) => {
  // A known isolated pin: the catalog now fits every site and clusters them.
  // Its current first-page count no longer says whether a map has rendered.
  await page.goto(`/shop/${privateShop.slug}/dive-sites/new`);
  await page.getByLabel("Name").fill("Accessibility reef");
  await page.getByLabel("Latitude").fill("25.30");
  await page.getByLabel("Longitude").fill("-80.00");
  await page.getByRole("button", { name: "Save dive site" }).click();
  await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);
  await page.goto(`/shop/${privateShop.slug}/dive-sites`);
  await expect(
    page
      .locator(".leaflet-site-marker")
      .getByRole("button", { name: "Accessibility reef", exact: true }),
  ).toBeVisible();
});

/** Deliberately inject spacing failures; clustering correctly removes them in normal UI. */
async function overlapPin(page: import("@playwright/test").Page) {
  await page
    .locator(".leaflet-site-marker")
    .getByRole("button", { name: "Accessibility reef", exact: true })
    .evaluate((pin) => {
      const marker = pin.parentElement;
      if (!marker) throw new Error("Missing marker wrapper");
      const neighbor = marker.cloneNode(true) as HTMLElement;
      neighbor.style.transform = `${marker.style.transform} translateX(8px)`;
      neighbor.querySelector("button")?.setAttribute("aria-label", "Nearby geographic pin");
      marker.parentElement?.append(neighbor);
    });
}

test("essential geographic pin spacing keeps every other accessibility check", async ({ page }) => {
  await overlapPin(page);
  const raw = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
  expect(raw.violations.some((violation) => violation.id === "target-size")).toBe(true);
  await expectNoA11yViolations(page);
  const details = page.getByRole("link", { name: "Accessibility reef", exact: true });
  await expect(details).toBeVisible();
  const bounds = await details.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await details.click({ position: { x: 24, y: 20 } });
  await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);
  await expect(
    page.getByRole("heading", { name: "Accessibility reef", exact: true }),
  ).toBeVisible();
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
  await page
    .locator(".leaflet-site-marker")
    .getByRole("button", { name: "Accessibility reef", exact: true })
    .press("Enter");
  await expect(page.locator(".leaflet-site-marker button.ring-4")).toHaveCount(1);
  await expect(page.locator(".leaflet-popup-content")).toHaveCount(1);
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
    .locator(".leaflet-site-marker")
    .getByRole("button", { name: "Accessibility reef", exact: true })
    .evaluate((pin) => {
      pin.removeAttribute("aria-label");
    });
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
});

test("an intrinsically undersized geographic pin still fails target-size", async ({ page }) => {
  await overlapPin(page);
  const pin = page
    .locator(".leaflet-site-marker")
    .getByRole("button", { name: "Accessibility reef", exact: true });
  await pin.evaluate((button) => {
    button.id = "tiny-pin-target";
    Object.assign(button.style, { width: "16px", height: "16px" });
  });
  await expect(pin).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("tiny-pin-target");
});
