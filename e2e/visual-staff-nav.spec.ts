/**
 * Captures the staff section navigation at normal scale and with enlarged text.
 * The tab bar can scroll within its own viewport; the page itself stays fixed
 * to the device width. The capture matrix includes phone and desktop.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

async function expectNavigationDoesNotExpandPage(page: Parameters<typeof capture>[0]) {
  const widths = await page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>("[data-staff-tabbar]");
    if (!nav) throw new Error("phone nav is missing");
    const withNavigation = document.documentElement.scrollWidth;
    nav.style.display = "none";
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const withoutNavigation = document.documentElement.scrollWidth;
    nav.style.removeProperty("display");
    return { withNavigation, withoutNavigation };
  });
  expect(widths.withNavigation).toBeLessThanOrEqual(widths.withoutNavigation);
}

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 }, ...VISUAL_STEP_BOUNDS });

test.describe("staff navigation", () => {
  signedInAsOwner();

  test("English section names render at phone and desktop widths", async ({ page }) => {
    await page.goto("/shop/blue-mantis/safety-checklist");
    await expect(page.locator("[data-staff-nav][data-hydrated=true]")).toHaveCount(2);
    await capture(page, "staff-navigation-english", "light", {
      beforeShot: () => expectNavigationDoesNotExpandPage(page),
    });
  });

  test.describe("Spanish", () => {
    test.use({ locale: SPANISH });

    test("full section names render at phone and desktop widths", async ({ page }) => {
      await page.goto("/shop/blue-mantis/safety-checklist");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await expect(nav.getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Buceadores", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Mensajes", exact: true })).toBeVisible();
      await capture(page, "staff-navigation-spanish", "light", {
        locale: SPANISH,
        beforeShot: () => expectNavigationDoesNotExpandPage(page),
      });
    });

    test("full section names render at 200% root text size", async ({ page }) => {
      await page.goto("/shop/blue-mantis/safety-checklist");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await capture(page, "staff-navigation-spanish-enlarged-text", "light", {
        locale: SPANISH,
        beforeShot: () => expectNavigationDoesNotExpandPage(page),
      });
    });

    test("More stays clear and usable at 200% text size", async ({ page }) => {
      await page.goto("/shop/blue-mantis/safety-checklist");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });

      const more = nav.getByRole("button", { name: "Más", exact: true });
      await expect(more).toBeVisible();
      await more.click();
      const settings = nav.locator('a[href="/shop/blue-mantis/settings"]');
      await expect(settings).toBeVisible();
      await capture(page, "staff-navigation-spanish-enlarged-text-more", "light", {
        locale: SPANISH,
        beforeShot: () => expectNavigationDoesNotExpandPage(page),
      });
    });

    test("Buceadores remains whole when reached by scrolling at 200% text size", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/safety-checklist");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await capture(page, "staff-navigation-spanish-enlarged-text-divers", "light", {
        locale: SPANISH,
        beforeShot: async () => {
          await page.locator("[data-staff-tab-scroll]").evaluate((element) => {
            const links = [...element.querySelectorAll<HTMLAnchorElement>("a")];
            const divers = links.find((link) => link.textContent?.includes("Buceadores"));
            if (!divers) throw new Error("Buceadores tab is missing");
            element.scrollLeft +=
              divers.getBoundingClientRect().left - element.getBoundingClientRect().left;
          });
          await expectNavigationDoesNotExpandPage(page);
        },
      });
    });

    test("Mensajes remains whole on keyboard focus at 200% text size", async ({ page }) => {
      await page.goto("/shop/blue-mantis/safety-checklist");
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await capture(page, "staff-navigation-spanish-enlarged-text-inbox", "light", {
        locale: SPANISH,
        beforeShot: async () => {
          const inbox = page.locator("[data-staff-tab-scroll] a").filter({ hasText: "Mensajes" });
          if (await inbox.isVisible()) await inbox.focus();
          await expectNavigationDoesNotExpandPage(page);
        },
      });
    });
  });
});
