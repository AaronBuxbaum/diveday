/**
 * Captures the staff section navigation at normal scale and with enlarged text.
 * The tab bar can scroll within its own viewport; the page itself stays fixed
 * to the device width. The capture matrix includes phone and desktop.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { seededTripId } from "./helpers";
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

async function expectPageWithinViewport(page: Parameters<typeof capture>[0]) {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

async function expectScrollCueMatchesRail(page: Parameters<typeof capture>[0]) {
  let lastMeasurement = "unmeasured";
  try {
    await expect
      .poll(async () => {
        const measurement = await page.evaluate(() => {
          const nav = document.querySelector<HTMLElement>("[data-staff-tabbar]");
          const rail = nav?.querySelector<HTMLElement>("[data-staff-tab-scroll]");
          if (!nav || !rail || getComputedStyle(nav).display === "none") return { hidden: true };
          const maxScroll = rail.scrollWidth - rail.clientWidth;
          const expected =
            maxScroll <= 1
              ? null
              : rail.scrollLeft <= 1
                ? "right"
                : rail.scrollLeft >= maxScroll - 1
                  ? "left"
                  : "both";
          return {
            viewport: innerWidth,
            clientWidth: rail.clientWidth,
            scrollWidth: rail.scrollWidth,
            scrollLeft: rail.scrollLeft,
            expected,
            rendered: nav.getAttribute("data-staff-tab-scroll-state"),
          };
        });
        lastMeasurement = JSON.stringify(measurement);
        return "hidden" in measurement || measurement.rendered === (measurement.expected ?? "none");
      })
      .toBe(true);
  } catch (error) {
    throw new Error(`scroll cue did not match rail: ${lastMeasurement}`, { cause: error });
  }
}

async function expectTabletTabsFillRail(page: Parameters<typeof capture>[0]) {
  const geometry = await page.evaluate(() => {
    if (innerWidth !== 820) return null;
    const nav = document.querySelector<HTMLElement>("[data-staff-tabbar]");
    const rail = nav?.querySelector<HTMLElement>("[data-staff-tab-scroll]");
    if (!nav || !rail || getComputedStyle(nav).display === "none") return null;
    const boxes = [...rail.querySelectorAll<HTMLAnchorElement>("a")].map((link) =>
      link.getBoundingClientRect(),
    );
    return {
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
      railRight: rail.getBoundingClientRect().right,
      lastTabRight: boxes.at(-1)?.right ?? 0,
      targetsMeet44px:
        boxes.length === 4 && boxes.every((box) => box.width >= 44 && box.height >= 44),
    };
  });
  if (!geometry) return;
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.lastTabRight).toBeGreaterThanOrEqual(geometry.railRight - 1);
  expect(geometry.targetsMeet44px).toBe(true);
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
      beforeShot: async () => {
        await expectNavigationDoesNotExpandPage(page);
        await expectScrollCueMatchesRail(page);
      },
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
        beforeShot: async () => {
          await expectNavigationDoesNotExpandPage(page);
          await expectScrollCueMatchesRail(page);
          await expectTabletTabsFillRail(page);
        },
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
        beforeShot: async () => {
          await expectNavigationDoesNotExpandPage(page);
          await expectScrollCueMatchesRail(page);
        },
      });
    });

    test("the prep route keeps its original 390px page width at 200% text", async ({ page }) => {
      const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
      await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
      const nav = page.getByRole("navigation", { name: "Principal", exact: true });
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const widths = await page.evaluate(async () => {
        const nav = document.querySelector<HTMLElement>("[data-staff-tabbar]");
        if (!nav) throw new Error("phone nav is missing");
        const withNav = document.documentElement.scrollWidth;
        nav.style.display = "none";
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const withoutNav = document.documentElement.scrollWidth;
        nav.style.removeProperty("display");
        return {
          route: location.pathname,
          viewportWidth: innerWidth,
          clientWidth: document.documentElement.clientWidth,
          withNav,
          withoutNav,
          rail: (() => {
            const rail = nav.querySelector<HTMLElement>("[data-staff-tab-scroll]");
            return rail ? { clientWidth: rail.clientWidth, scrollWidth: rail.scrollWidth } : null;
          })(),
          wideElements: [...document.querySelectorAll<HTMLElement>("body *")]
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(
              ({ element, rect }) =>
                getComputedStyle(element).display !== "none" && rect.right > innerWidth + 1,
            )
            .sort((a, b) => b.rect.right - a.rect.right)
            .slice(0, 5)
            .map(({ element, rect }) => ({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className : "",
              right: Math.round(rect.right),
              text: element.textContent?.trim().slice(0, 48),
            })),
        };
      });
      await test.info().attach("prep-spanish-200-percent-widths", {
        body: JSON.stringify(widths, null, 2),
        contentType: "application/json",
      });
      expect(widths.withNav, JSON.stringify(widths)).toBe(widths.viewportWidth);
      expect(widths.withoutNav, JSON.stringify(widths)).toBe(widths.viewportWidth);
      expect(widths.withNav).toBeLessThanOrEqual(widths.withoutNav);

      // The differential width probe temporarily hides the fixed bar. Reload
      // before capturing so the product state and the probe state stay apart.
      await page.reload();
      await expect(nav).toHaveAttribute("data-hydrated", "true");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await expectPageWithinViewport(page);
      await expectScrollCueMatchesRail(page);
      await capture(page, "staff-navigation-prep-spanish-enlarged-text", "light", {
        locale: SPANISH,
        beforeShot: async () => {
          await expectPageWithinViewport(page);
          await expectScrollCueMatchesRail(page);
        },
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
        beforeShot: async () => {
          await expectNavigationDoesNotExpandPage(page);
          await expectScrollCueMatchesRail(page);
        },
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
          await expectScrollCueMatchesRail(page);
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
          await expectScrollCueMatchesRail(page);
        },
      });
    });
  });
});
