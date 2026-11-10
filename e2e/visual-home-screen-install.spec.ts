/** Visual captures: contextual staff home-screen entry and its desktop suppression. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  INSTALL_ANDROID_UA,
  INSTALL_DESKTOP_UA,
  INSTALL_SAFARI_UA,
  offerNativeInstall,
} from "./home-screen-install-helper";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = staffTranslator("en-US");

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 }, hasTouch: true });
    test.describe("staff", () => {
      signedInAsOwner();
      for (const kind of ["safari", "native"] as const) {
        test(`Logbook home-screen entry ${kind} (${scheme})`, async ({ page }) => {
          await page.addInitScript(
            ({ mobile, desktop }) => {
              Object.defineProperty(navigator, "userAgent", {
                get: () => (innerWidth >= 1200 ? desktop : mobile),
              });
              Object.defineProperty(navigator, "maxTouchPoints", {
                get: () => (innerWidth >= 1200 ? 0 : 5),
              });
            },
            {
              mobile: kind === "safari" ? INSTALL_SAFARI_UA : INSTALL_ANDROID_UA,
              desktop: INSTALL_DESKTOP_UA,
            },
          );
          await page.goto("/shop/blue-mantis");
          await expect(page.locator("[data-home-screen-install]")).toBeVisible();
          const options = {
            beforeShot: async () => {
              await page.reload();
              const row = page.locator("[data-home-screen-install]");
              if ((page.viewportSize()?.width ?? 0) >= 1200) {
                await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
                await expect(row).toHaveCount(0);
              } else {
                await expect(row).toBeVisible();
                if (kind === "native") {
                  expect(await offerNativeInstall(page)).toBe(true);
                  await expect(
                    row.getByRole("button", { name: t("shopHome.install.action") }),
                  ).toBeVisible();
                } else await expect(row).toContainText(t("shopHome.install.safari"));
              }
            },
          };
          if (kind === "safari")
            await capture(page, "today-home-screen-install-safari", scheme, options);
          else await capture(page, "today-home-screen-install-native", scheme, options);
        });
      }
    });
  });
}
