import { expect, signedInAsOwner, test } from "./fixtures";

test.describe("warm navigation with a viewport-height fallback", () => {
  signedInAsOwner();

  test("a departure does not restore the board scroll after its fallback clamps to zero", async ({
    page,
  }) => {
    const boardOffset = 157;
    await page.goto("/shop/blue-mantis/schedule/board");
    const departure = page.locator("[data-week-board] a[data-departure-door]").first();
    await expect(departure).toBeVisible();
    const href = await departure.getAttribute("href");
    const tripId = href?.split("/").at(-1);
    if (!tripId) throw new Error("The departure link has no trip ID");

    await departure.click();
    await expect(page.locator("#roster")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Schedule" })
      .click();
    await expect(departure).toBeVisible();
    await page.evaluate((y) => window.scrollTo(0, y), boardOffset);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(boardOffset);
    await expect(departure).toBeInViewport();

    // Model a short fallback without changing the board or final trip content.
    // Keeping the skeleton itself visible lets us verify it really streamed.
    await page.addStyleTag({
      content:
        "[data-trip-loading] { height: 1px !important; overflow: hidden !important; } body:has([data-trip-loading]) [data-staff-sidebar] { height: 1px !important; }",
    });
    const armed = await page.request.post("/api/test/navigation-gate", {
      data: { tripId, action: "arm" },
    });
    expect(armed.ok()).toBe(true);
    const click = departure.click();
    try {
      await expect(page).toHaveURL(/\/trips\//);
      await expect(page.locator("[data-trip-loading]:visible")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => ({
            max: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            y: window.scrollY,
          })),
        )
        .toEqual({ max: 0, y: 0 });
    } finally {
      const released = await page.request.post("/api/test/navigation-gate", {
        data: { tripId, action: "release" },
      });
      expect(released.ok()).toBe(true);
    }
    await click;
    await expect(page.locator("#roster")).toBeVisible();
    const landing = await page.evaluate(() => {
      const main = document.querySelector("main");
      const bar = document.querySelector("[data-chrome-bar]")?.getBoundingClientRect();
      const heading = document.querySelector("main h1")?.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        maxTop: Math.max(
          0,
          Math.round(
            (main?.getBoundingClientRect().top ?? 0) + window.scrollY - (bar?.height ?? 0),
          ),
        ),
        clearance: bar && heading ? Math.round(heading.top - bar.bottom) : null,
      };
    });
    expect(landing.scrollY, "the departure opened partway down itself").toBeLessThanOrEqual(
      landing.maxTop,
    );
    expect(landing.clearance, "the departure heading was left under the staff bar").not.toBeNull();
    expect(landing.clearance ?? -1).toBeGreaterThanOrEqual(0);
  });
});
