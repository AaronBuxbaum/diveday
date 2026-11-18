import { staffTranslator } from "../src/i18n/staff-messages";
import {
  expect,
  PAGE_BODY_PROBE,
  SETTINGS_RAIL_PROBE,
  STAFF_HYDRATION_PROBE,
  settleStaffHydration,
  signedInAsOwner,
  test,
} from "./fixtures";

test.describe("Trip navigation readiness", () => {
  signedInAsOwner();

  test("waits for the streamed Trip body before returning", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    const href = await page
      .locator("[data-week-board] a[data-departure-door]")
      .first()
      .getAttribute("href");
    const tripId = href?.split("/").at(-1);
    if (!href || !tripId) throw new Error("The departure link has no trip ID");
    expect(
      (
        await page.request.post("/api/test/navigation-gate", { data: { tripId, action: "arm" } })
      ).ok(),
    ).toBe(true);
    const browserPage = await page.context().newPage();
    await browserPage.goto(href, { waitUntil: "commit" });
    try {
      await expect(browserPage.locator("[data-trip-loading]:visible")).toBeVisible();
      await expect(browserPage.locator(PAGE_BODY_PROBE).filter({ visible: true })).toHaveCount(0);
      await expect(browserPage.locator(STAFF_HYDRATION_PROBE).first()).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      // Observe when the helper reaches either its Trip-body wait or its last
      // existing check. This makes gate release independent of wall-clock speed.
      const checkpoint = Promise.withResolvers<"body" | "end">();
      const originalLocator = browserPage.locator.bind(browserPage);
      browserPage.locator = ((
        selector: string,
        options?: Parameters<typeof browserPage.locator>[1],
      ) => {
        if (selector.startsWith(`${PAGE_BODY_PROBE}:visible,`)) checkpoint.resolve("body");
        if (selector.startsWith(`${SETTINGS_RAIL_PROBE}:not`)) checkpoint.resolve("end");
        return originalLocator(selector, options);
      }) as typeof browserPage.locator;
      const navigation = settleStaffHydration(browserPage);
      void navigation.catch(() => undefined);
      const reached = await checkpoint.promise;
      if (reached === "end") {
        await navigation;
      } else {
        expect(
          (
            await page.request.post("/api/test/navigation-gate", {
              data: { tripId, action: "release" },
            })
          ).ok(),
        ).toBe(true);
        await navigation;
      }
      expect(await browserPage.locator(`${PAGE_BODY_PROBE}:visible`).count()).toBe(1);
      expect(
        await browserPage.locator(`${PAGE_BODY_PROBE}:visible`).getAttribute("data-hydrated"),
      ).toBe("true");
    } finally {
      await page.request.post("/api/test/navigation-gate", { data: { tripId, action: "release" } });
      await browserPage.close();
    }
  });
  test("commit navigation can observe the Trip loading state", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    const href = await page
      .locator("[data-week-board] a[data-departure-door]")
      .first()
      .getAttribute("href");
    const tripId = href?.split("/").at(-1);
    if (!href || !tripId) throw new Error("The departure link has no trip ID");
    expect(
      (
        await page.request.post("/api/test/navigation-gate", { data: { tripId, action: "arm" } })
      ).ok(),
    ).toBe(true);
    try {
      await page.goto(href, { waitUntil: "commit" });
      await expect(page.locator("[data-trip-loading]:visible")).toBeVisible();
      await expect(page.locator(PAGE_BODY_PROBE).filter({ visible: true })).toHaveCount(0);
    } finally {
      expect(
        (
          await page.request.post("/api/test/navigation-gate", {
            data: { tripId, action: "release" },
          })
        ).ok(),
      ).toBe(true);
    }
    await settleStaffHydration(page);
    await expect(page.locator(`${PAGE_BODY_PROBE}:visible`)).toHaveAttribute(
      "data-hydrated",
      "true",
    );
  });

  test("allows the Trip not-found page and unrelated staff routes", async ({ page }) => {
    await page.goto("/shop/blue-mantis/trips/00000000-0000-4000-8000-000000000000");
    await expect(
      page.getByRole("heading", { name: staffTranslator("en-US")("shared.notFound.heading") }),
    ).toBeVisible();
    await page.goto("/shop/blue-mantis/schedule/board");
    await expect(page.locator("[data-week-board]")).toBeVisible();
  });
});
