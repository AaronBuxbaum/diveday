/** ADR 20260907-in-your-hands 19d: captures use simulated device-body readings. */

import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed-trips";
import { staffTranslator } from "../src/i18n/staff-messages";
import { exposeDeviceBody, fragmentedWords } from "./device-text-size-fixture";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  manifestRow,
  offlineCopySaved,
  openManifestPerson,
  openTripFromBoard,
  openTripTab,
} from "./helpers";
import { INSTALL_SAFARI_UA } from "./home-screen-install-helper";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const bodySize of [34, 53]) {
  test.describe(`light mode device body ${bodySize}px`, () => {
    signedInAsOwner();
    test.use({ reducedMotion: "reduce" });
    test(`the current manifest and navigation at a simulated ${bodySize}px device body`, async ({
      page,
    }) => {
      await exposeDeviceBody(page, bodySize);
      await page.goto("/shop/blue-mantis/schedule/board");
      await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
      await openTripTab(page, "Manifest");
      await expect(page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ })).toBeVisible();
      await offlineCopySaved(page);
      if (bodySize === 34) await capture(page, "manifest-device-body-34", "light");
      else {
        await capture(page, "manifest-device-body-53", "light");
        await page.emulateMedia({ colorScheme: "dark" });
        await capture(page, "manifest-device-body-53", "dark", { darkPhone: true });
      }
    });
    test(`the public form at a simulated ${bodySize}px device body`, async ({ page }) => {
      await exposeDeviceBody(page, bodySize);
      await page.goto("/s/blue-mantis/register");
      await expect(page.getByRole("textbox").first()).toBeVisible();
      if (bodySize === 34) await capture(page, "public-form-device-body-34", "light");
      else {
        await capture(page, "public-form-device-body-53", "light");
        await page.emulateMedia({ colorScheme: "dark" });
        await capture(page, "public-form-device-body-53", "dark", { darkPhone: true });
      }
    });
  });
}

test.describe("light mode largest device body install entry", () => {
  signedInAsOwner();
  test.use({ userAgent: INSTALL_SAFARI_UA, hasTouch: true, reducedMotion: "reduce" });
  test("the eligible Logbook install entry at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis");
    await expect(page.locator("[data-home-screen-install]")).toBeVisible();
    await capture(page, "install-entry-device-body-53", "light");
  });
});

test.describe("light mode largest device body staff navigation", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("the current staff navigation at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/safety-checklist");
    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(nav).toHaveAttribute("data-hydrated", "true");
    await nav.getByRole("link", { name: "Divers", exact: true }).focus();
    await capture(page, "staff-navigation-device-body-53", "light");
  });
});

test.describe("light mode largest device body person sheet", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("the person name and close action at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    await openManifestPerson(manifestRow(page, "Priya Sharma"));
    await expect(page.getByRole("dialog", { name: "Priya Sharma", exact: true })).toBeVisible();
    await capture(page, "person-sheet-device-body-53", "light");
  });
});

test.describe("light mode largest device body after-dive warnings", () => {
  // privateShop supplies its owner session and keeps these safety marks isolated.
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("a missing diver and crew member stay named at a simulated 53px device body", async ({
    page,
    request,
    privateShop,
  }) => {
    const copy = staffTranslator("en-US");
    const { operationalTrust: state } = await seedFacts(
      request,
      [{ name: "operationalTrust", state: "capacity" }],
      { slug: privateShop.slug },
    );
    await exposeDeviceBody(page, 53);
    const path = `/shop/${privateShop.slug}/trips/${state.tripId}/manifest`;
    await page.goto(path);
    await page.getByRole("button", { name: copy("manifest.crewMarkAboard"), exact: true }).click();
    await expect(
      page.getByRole("button", { name: copy("manifest.crewAboardCheckAriaLabel"), exact: true }),
    ).toHaveCount(2);
    await page.goto(`${path}?checkpoint=after_dive_1`);
    for (const name of ["Ari Vale", state.crewName]) {
      await page
        .getByRole("button", { name: copy("manifest.openPersonDetails", { name }), exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: copy("manifest.markNotBackAboard"), exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: copy("manifest.notBackAboardActive"), exact: true }),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: copy("manifest.closePersonDetails"), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    }
    const panel = page.locator("[data-roll-call-panel]");
    await expect(
      panel.getByText(copy("manifest.notBackAboardOpen", { count: 1 }), { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText(copy("manifest.crewNotBackAboard", { count: 1 }), { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("link", { name: "Ari Vale", exact: true })).toBeVisible();
    await expect(panel.getByRole("link").filter({ hasText: state.crewName })).toBeVisible();
    await expect(panel).toHaveAttribute("data-roll-call-panel-flow", "true");
    await expect(panel).toHaveCSS("max-height", "none");
    const count = panel.getByRole("progressbar");
    await count.scrollIntoViewIfNeeded();
    await expect(count).toBeInViewport({ ratio: 1 });
    await capture(page, "manifest-warnings-device-body-53", "light");
    const missingLinks = panel.getByRole("link");
    await expect(missingLinks).toHaveCount(2);
    for (const link of await missingLinks.all()) {
      expect.soft(await fragmentedWords(link)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await capture(page, "manifest-warnings-device-body-53", "dark", { darkPhone: true });
  });
});

test.describe("light mode largest device body checklist editor", () => {
  signedInAsOwner();
  test.use({ reducedMotion: "reduce" });
  test("the readable checklist editor at a simulated 53px device body", async ({ page }) => {
    await exposeDeviceBody(page, 53);
    await page.goto("/shop/blue-mantis/safety-checklist");
    const editor = page.locator("#checklist-new");
    await editor.locator("summary").click();
    const field = editor.getByRole("textbox", { name: "New line", exact: true });
    await field.fill("Large type check");
    await capture(page, "checklist-editor-device-body-53", "light");
    await page.goto("/shop/blue-mantis/settings/profile");
    const tagline = page.getByRole("textbox", { name: "Tagline", exact: true });
    await tagline.fill("Large type check");
    await capture(page, "settings-editor-device-body-53", "light", {
      beforeShot: async () => tagline.focus(),
    });
    await page.setViewportSize({ width: 1024, height: 844 });
    await tagline.focus();
    await page.screenshot({
      path: test.info().outputPath("settings-editor-1024.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await capture(page, "settings-editor-device-body-53", "dark", { darkPhone: true });
  });
});

test.describe("light mode unchanged device body", () => {
  signedInAsOwner();
  test.use({ reducedMotion: "reduce" });
  test("the ordinary 16px manifest keeps its existing composition", async ({ page }) => {
    await exposeDeviceBody(page, 17);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
    await openTripTab(page, "Manifest");
    await offlineCopySaved(page);
    await expect(page.locator("html")).not.toHaveAttribute("data-device-text-size");
    await capture(page, "manifest-device-body-default", "light");
    await page.goto("/s/blue-mantis/register");
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await capture(page, "public-form-device-body-default", "light");
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture(page, "logbook-device-body-default", "light");
    await page.goto("/shop/blue-mantis/settings/profile");
    await expect(page.getByRole("textbox", { name: "Tagline", exact: true })).toBeVisible();
    await capture(page, "settings-editor-device-body-default", "light");
  });
});
