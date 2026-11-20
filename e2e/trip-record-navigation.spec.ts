import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openCounterFor, openRosterDetails, rosterRow } from "./helpers";
import { seedFacts } from "./shop-facts";

const t = staffTranslator("en-US");
test.describe("private trip", () => {
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
      await expect(
        page.getByRole("link", { name: t("trips.clock.ready.paperPasses") }),
      ).toHaveCount(0);
      await expect(page.getByText(t("trips.clock.ready.paperPassesUnavailable"))).toBeVisible();
      await page.goto(`${trip}?phase=wrapped`);
      await page.getByRole("link", { name: t("desk.lostFound.heading"), exact: true }).click();
      await expect(page.locator("#wrapped-more")).toHaveAttribute("open", "");
      await expect(page.locator("#found-aboard")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("existing sightings", () => {
  signedInAsOwner();
  test("Wrapped up opens the existing sightings tally", async ({ page, request }) => {
    test.slow();
    const { returnedConservationRecap } = (await seedFacts(request, [
      "returnedConservationRecap",
    ])) as { returnedConservationRecap: { tripId: string } };
    await page.goto(`/shop/blue-mantis/trips/${returnedConservationRecap.tripId}?phase=wrapped`);
    const sightings = page.getByRole("link", {
      name: t("trips.clock.wrapped.diveSightings", { dive: 1 }),
    });
    await expect(sightings).toBeVisible();
    await sightings.click();
    await expect(page.locator("#seen-heading")).toBeVisible();
  });
});

test.describe("available paper passes", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("Getting ready leads to a cleared arrived guest's pass", async ({ page, privateShop }) => {
    test.slow();
    await openCounterFor(page, privateShop.slug, "Diego Alvarez");
    await expect(page.locator("[data-check-in-queue]")).toHaveAttribute("data-hydrated", "true");
    const row = await rosterRow(page, "Diego Alvarez");
    await row.getByRole("button", { name: "Check in Diego Alvarez" }).click();
    await expect(
      row.getByRole("button", { name: "Undo check-in for Diego Alvarez" }),
    ).toBeVisible();
    const trip = new URL(page.url()).pathname;
    await page.goto(`${trip}?phase=ready`);
    await page.getByRole("link", { name: t("trips.clock.ready.paperPasses") }).click();
    const arrived = await rosterRow(page, "Diego Alvarez");
    await openRosterDetails(arrived);
    await arrived.getByRole("link", { name: "Print a pass" }).click();
    await expect(page.locator(".paper-sheet").getByText("Diego Alvarez").first()).toBeVisible();
  });
});
