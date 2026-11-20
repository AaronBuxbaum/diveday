import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";

const t = staffTranslator("en-US");
test.use({ storageState: { cookies: [], origins: [] } });

for (const width of [390, 1280]) {
  test(`trip records and paper-pass navigation fit at ${width}px`, async ({
    page,
    request,
    privateShop,
  }) => {
    test.slow();
    await page.setViewportSize({ width, height: 844 });
    const { boatOnTheWater } = (await seedFacts(
      request,
      [{ name: "boatOnTheWater", state: "home" }],
      { slug: privateShop.slug },
    )) as { boatOnTheWater: { tripId: string } };
    const trip = `/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}`;
    await page.goto(`${trip}?phase=ready`);
    const passes = page.getByRole("link", { name: t("trips.clock.ready.paperPasses") });
    await expect(passes).toBeVisible();
    await passes.click();
    await expect(page).toHaveURL(/phase=checkin/);
    await page.goto(`${trip}?phase=wrapped`);
    await page.getByRole("link", { name: t("desk.lostFound.heading"), exact: true }).click();
    await expect(page.locator("#wrapped-more")).toHaveAttribute("open", "");
    await expect(page.locator("#found-aboard")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const sightings = page.getByRole("link", {
      name: t("trips.clock.wrapped.diveSightings", { dive: 1 }),
    });
    if (await sightings.count()) {
      await sightings.click();
      await expect(page.locator("#seen-heading")).toBeVisible();
    }
  });
}
