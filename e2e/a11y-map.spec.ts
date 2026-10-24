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

async function openLibraryMap(page: Page) {
  await page.goto("/shop/blue-mantis/dive-sites");
  await expect(page.locator(".leaflet-site-marker button").first()).toBeVisible();
  await expectMapSiteCount(page, 8);
}

test("essential geographic pin spacing keeps every other accessibility check", async ({ page }) => {
  await openLibraryMap(page);
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
});

test("catalog accessibility keeps detail navigation usable", async ({ page }) => {
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
  await openLibraryMap(page);
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
  await openLibraryMap(page);
  const zoom = page.locator(".leaflet-control-zoom-in");
  await zoom.evaluate((control) => {
    control.id = "zoom-small-target";
    Object.assign(control.style, {
      width: "16px",
      height: "16px",
      minWidth: "16px",
      minHeight: "16px",
    });
    const neighbor = control.nextElementSibling;
    if (neighbor instanceof HTMLElement) {
      Object.assign(neighbor.style, {
        position: "absolute",
        left: "0",
        top: "8px",
        width: "16px",
        height: "16px",
        minWidth: "16px",
        minHeight: "16px",
      });
    }
  });
  await expect(zoom).toBeVisible();
  const target = await zoom.boundingBox();
  expect(target?.width).toBe(16);
  expect(target?.height).toBe(16);
  await expect(expectNoA11yViolations(page)).rejects.toThrow("zoom-small-target");
});

test("an undersized popup control still fails target-size", async ({ page }) => {
  await openLibraryMap(page);
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
  await openLibraryMap(page);
  await page
    .locator(".leaflet-site-marker button")
    .first()
    .evaluate((pin) => {
      pin.removeAttribute("aria-label");
    });
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
});

test("an intrinsically undersized geographic pin still fails target-size", async ({ page }) => {
  await openLibraryMap(page);
  await overlapNativePinPair(page);
  const pair = page.locator(".leaflet-site-marker button");
  // Keep two genuinely small targets close together, including their glyphs.
  // axe marks an undersized target with overflowing content as incomplete,
  // so shrinking only the button while retaining its 20px SVG tests that
  // separate ambiguity instead of an intrinsically small reachable target.
  await pair.evaluateAll((buttons) => {
    for (const [index, button] of buttons.slice(0, 2).entries()) {
      if (!(button instanceof HTMLElement)) throw new Error("Site target did not mount");
      button.id = index === 0 ? "tiny-pin-target" : "tiny-pin-neighbor";
      Object.assign(button.style, {
        width: "16px",
        height: "16px",
        minWidth: "16px",
        minHeight: "16px",
      });
      const glyph = button.querySelector("svg");
      if (!glyph) throw new Error("Site glyph did not mount");
      Object.assign(glyph.style, { width: "12px", height: "12px" });
    }
  });
  const pin = page.locator("#tiny-pin-target");
  const neighbor = page.locator("#tiny-pin-neighbor");
  await expect(pin).toBeVisible();
  await expect(neighbor).toBeVisible();
  const targetBox = await pin.boundingBox();
  const neighborBox = await neighbor.boundingBox();
  if (!targetBox || !neighborBox) throw new Error("Undersized site pair has no bounds");
  for (const box of [targetBox, neighborBox]) {
    expect(box.width).toBe(16);
    expect(box.height).toBe(16);
  }
  expect(
    Math.hypot(
      targetBox.x + targetBox.width / 2 - neighborBox.x - neighborBox.width / 2,
      targetBox.y + targetBox.height / 2 - neighborBox.y - neighborBox.height / 2,
    ),
  ).toBeLessThan(24);
  for (const target of [pin, neighbor]) {
    expect(
      await target.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return [...button.querySelectorAll("svg, svg *")].every((glyph) => {
          const content = glyph.getBoundingClientRect();
          return (
            content.left >= bounds.left &&
            content.top >= bounds.top &&
            content.right <= bounds.right &&
            content.bottom <= bounds.bottom
          );
        });
      }),
    ).toBe(true);
  }
  await pin.focus();
  await expect(pin).toBeFocused();
  const raw = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
  expect(
    raw.violations.some(
      (violation) =>
        violation.id === "target-size" &&
        violation.nodes.some((node) => node.target.includes("#tiny-pin-target")),
    ),
    JSON.stringify({ violations: raw.violations, incomplete: raw.incomplete }, null, 2),
  ).toBe(true);
  await expect(expectNoA11yViolations(page)).rejects.toThrow("tiny-pin-target");
});

/**
 * **Every press on the map takes 44px, at a phone and at a desk** (issue
 * #2889). Measured where a finger lands, not read from a class: the zoom
 * buttons, each site pin and cluster, the shop's badge (which must sit wholly
 * inside the map, never clipped at its edge), and the popup's close, whose
 * visible circle is smaller and whose press reaches 22px from its center on
 * every side. The selection is made at 1280 and carried to 390, as the
 * selected-pin capture does, and the close still closes.
 */
for (const width of [390, 1280]) {
  test(`map controls and markers take a 44px press at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLibraryMap(page);
    await page.clock.install({ time: E2E_FROZEN_CLOCK });
    await page.locator(".leaflet-site-marker button").first().press("Enter");
    await expect(page.locator(".leaflet-site-popup")).toHaveCount(1);
    if (width !== 1280) await page.setViewportSize({ width, height: 844 });
    await page.locator(".leaflet-container").scrollIntoViewIfNeeded();

    const map = await page.locator(".leaflet-container").boundingBox();
    if (!map) throw new Error("Site map has no bounds");
    for (const selector of [
      ".leaflet-control-zoom-in",
      ".leaflet-control-zoom-out",
      ".leaflet-site-marker button",
      "button.leaflet-site-cluster",
      ".leaflet-shop-landmark",
    ]) {
      const targets = page.locator(selector).filter({ visible: true });
      for (const box of await targets.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
        }),
      )) {
        expect(box.width, selector).toBeGreaterThanOrEqual(44);
        expect(box.height, selector).toBeGreaterThanOrEqual(44);
        if (selector === ".leaflet-shop-landmark") {
          expect(box.left, "the shop badge inside the map's left edge").toBeGreaterThanOrEqual(
            map.x,
          );
          expect(box.right).toBeLessThanOrEqual(map.x + map.width);
        }
      }
    }

    const close = page.getByRole("button", { name: "Close popup" });
    await expect(close).toBeVisible();
    const reach = await close.evaluate((control) => {
      const rect = control.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return [
        [-21, 0],
        [21, 0],
        [0, -21],
        [0, 21],
      ].map(([dx, dy]) => {
        const hit = document.elementFromPoint(x + dx, y + dy);
        return hit !== null && control.contains(hit);
      });
    });
    expect(reach).toEqual([true, true, true, true]);
    await close.click();
    await expect(page.locator(".leaflet-site-popup")).toHaveCount(0);
  });
}
