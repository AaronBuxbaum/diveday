import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  INSTALL_ANDROID_UA,
  INSTALL_DESKTOP_UA,
  INSTALL_SAFARI_UA,
  offerNativeInstall,
} from "./home-screen-install-helper";

import { mintOnboardFormPath } from "./setup-link";

const t = staffTranslator("en-US");
const hint = "[data-home-screen-install]";

test.describe("home-screen entry on a staff phone", () => {
  test.use({
    userAgent: INSTALL_ANDROID_UA,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  signedInAsOwner();

  test("Chrome instructions follow the work, dismissal survives navigation and reload", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    const row = page.locator(hint);
    await expect(row).toContainText(t("shopHome.install.chrome"));
    await expect(row.getByRole("button", { name: t("shopHome.install.action") })).toHaveCount(0);
    const operational = page.getByRole("heading", { name: "Needs you" });
    await expect(operational).toBeVisible();
    expect(
      await operational.evaluate(
        (node) =>
          !!(
            node.compareDocumentPosition(
              document.querySelector("[data-home-screen-install]") as Element,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    ).toBe(true);
    const url = page.url();
    await row.getByRole("button", { name: t("shopHome.install.dismiss") }).click();
    await expect(row).toHaveCount(0);
    expect(page.url()).toBe(url);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  for (const outcome of ["accepted", "dismissed"] as const) {
    test(`only an available native event exposes the action, ${outcome} retires it`, async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis");
      const row = page.locator(hint);
      await expect(row).toBeVisible();
      expect(await offerNativeInstall(page, outcome)).toBe(true);
      const install = row.getByRole("button", { name: t("shopHome.install.action") });
      await expect(install).toBeVisible();
      await install.click();
      await expect(row).toHaveCount(0);
      expect(await page.locator("html").getAttribute("data-install-calls")).toBe("1");
      expect(await offerNativeInstall(page)).toBe(false);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(row).toHaveCount(0);
    });
  }

  test("a refused storage read stays quiet and does not prevent operational work", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage refused", "SecurityError");
        },
      }),
    );
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.locator(hint)).toHaveCount(0);
  });

  test("installed mode never shows the row", async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        query.includes("display-mode: standalone")
          ? Object.defineProperty(original(query), "matches", { value: true })
          : original(query);
    });
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.locator(hint)).toHaveCount(0);
    expect(await offerNativeInstall(page)).toBe(false);
  });
});

test.describe("home-screen entry on an iPad", () => {
  test.use({
    userAgent: INSTALL_SAFARI_UA.replace("iPhone; CPU iPhone", "iPad; CPU"),
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
  });
  signedInAsOwner();
  test("names Safari Share and Add to Home Screen without a native button", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.locator(hint)).toContainText(t("shopHome.install.safari"));
    expect(await offerNativeInstall(page)).toBe(false);
    await expect(page.getByRole("button", { name: t("shopHome.install.action") })).toHaveCount(0);
  });
});

test.describe("home-screen entry on desktop", () => {
  test.use({ userAgent: INSTALL_DESKTOP_UA, viewport: { width: 1280, height: 800 } });
  signedInAsOwner();
  test("a desktop or narrow desktop tab never shows the mobile affordance", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.locator(hint)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.locator(hint)).toHaveCount(0);
  });
});

test.describe("home-screen entry on the first morning", () => {
  test.use({
    userAgent: INSTALL_ANDROID_UA,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  test("keeps the first setup task ahead of the install hint", async ({ page }) => {
    const slug = `install-first-${Date.now()}`;
    await page.goto(await mintOnboardFormPath(page));
    await page
      .locator('input[name="shopName"]')
      .filter({ visible: true })
      .fill("Install First Morning");
    await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(slug);
    await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
    await page
      .locator('input[name="ownerEmail"]')
      .filter({ visible: true })
      .fill(`${slug}@example.com`);
    await page
      .locator('input[name="ownerPassword"]')
      .filter({ visible: true })
      .fill("trial-pass-123");
    await page.getByRole("button", { name: "Create shop & start trial" }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${slug}$`));
    const primary = page.locator('[data-first-run-primary="true"]');
    await expect(primary).toBeVisible();
    await expect(page.locator(hint)).toBeVisible();
    expect(
      await primary.evaluate(
        (node) =>
          !!(
            node.compareDocumentPosition(
              document.querySelector("[data-home-screen-install]") as Element,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    ).toBe(true);
  });
});
