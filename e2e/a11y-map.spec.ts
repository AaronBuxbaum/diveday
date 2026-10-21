import AxeBuilder from "@axe-core/playwright";
import { expectNoA11yViolations } from "./a11y-scan";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test.beforeEach(async ({ page }) => {
  await page.goto("/shop/blue-mantis/dive-sites/catalog");
  await expect(page.locator(".leaflet-site-marker button")).toHaveCount(20);
});

test("essential geographic pin spacing keeps every other accessibility check", async ({ page }) => {
  const raw = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
  expect(raw.violations.some((violation) => violation.id === "target-size")).toBe(true);
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
  await page.locator(".leaflet-site-marker button").first().press("Enter");
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
    .locator(".leaflet-site-marker button")
    .first()
    .evaluate((pin) => {
      pin.removeAttribute("aria-label");
    });
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
});

test("an intrinsically undersized geographic pin still fails target-size", async ({ page }) => {
  const pin = page.locator(".leaflet-site-marker button").first();
  await pin.evaluate((button) => {
    button.id = "tiny-pin-target";
    Object.assign(button.style, { width: "16px", height: "16px" });
  });
  await expect(pin).toBeVisible();
  await expect(expectNoA11yViolations(page)).rejects.toThrow("tiny-pin-target");
});
