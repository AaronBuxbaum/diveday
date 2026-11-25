import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      test.use({
        storageState: { cookies: [], origins: [] },
        privateShopSlug: "trip-look-back-review",
      });
      test(`a historical check-in points to open close-out items (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const { boatOnTheWater } = (await seedFacts(
          request,
          [{ name: "boatOnTheWater", state: "unfinished" }],
          { slug: privateShop.slug },
        )) as { boatOnTheWater: { tripId: string } };
        await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=checkin`);
        await expect(
          page.getByRole("link", {
            name: staffCopy("trips.clock.wrapped.lookBackOpen", { count: 2 }),
          }),
        ).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        const link = page.getByRole("link", {
          name: staffCopy("trips.clock.wrapped.lookBackOpen", { count: 2 }),
        });
        const bounds = await link.boundingBox();
        const navBounds = await page.locator("nav[data-staff-nav]:visible").boundingBox();
        if (!bounds || !navBounds)
          throw new Error("The close-out link or staff navigation is missing");
        expect(bounds.y + bounds.height).toBeLessThan(navBounds.y);
        const rollCallBounds = await page
          .getByRole("link", { name: staffCopy("trips.clock.rollCall"), exact: true })
          .first()
          .boundingBox();
        if (!rollCallBounds) throw new Error("The roll call door is missing");
        expect(rollCallBounds.y + rollCallBounds.height).toBeLessThan(navBounds.y);
        await capture(page, "trip-checkin-look-back", scheme);
      });
      // A dive the crew never counted is recorded not made from its own
      // close-out row, then shows with who and when under What happened (#4681).
      test(`a dive not made closes its own roll-call item (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const { boatOnTheWater } = (await seedFacts(
          request,
          [{ name: "boatOnTheWater", state: "skipped" }],
          { slug: privateShop.slug },
        )) as { boatOnTheWater: { tripId: string } };
        await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=wrapped`);
        const notMade = staffCopy("trips.clock.wrapped.notMadeAction", { dive: 2 });
        await page.getByRole("button", { name: notMade }).click();
        await expect(
          page.getByText(staffCopy("trips.clock.wrapped.notMadeConfirm", { dive: 2 })),
        ).toBeVisible();
        await capture(page, "trip-wrapped-dive-not-made-offer", scheme);
        await page.getByRole("button", { name: notMade }).last().click();
        await page.waitForURL(/notice=dive-not-made/);
        // Reopened without the notice, so its toast never sits over the picture.
        await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=wrapped`);
        await expect(
          page.getByRole("button", { name: staffCopy("trips.clock.wrapped.notMadeUndo") }),
        ).toBeVisible();
        await capture(page, "trip-wrapped-dive-not-made", scheme);
      });
      // What was seen and what was left aboard, each a row in What happened
      // that opens its record (#4683, #4811). One theme: rows of plain text.
      if (scheme === "light") {
        test(`What happened says what was seen and left aboard (${scheme})`, async ({
          page,
          request,
          privateShop,
        }) => {
          const { boatOnTheWater } = (await seedFacts(
            request,
            [{ name: "boatOnTheWater", state: "recorded" }],
            { slug: privateShop.slug },
          )) as { boatOnTheWater: { tripId: string } };
          await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}?phase=wrapped`);
          const what = page.getByRole("region", {
            name: staffCopy("trips.clock.wrapped.whatHappened"),
          });
          await expect(
            what.getByText(staffCopy("trips.clock.wrapped.species", { count: 2 })),
          ).toBeVisible();
          await expect(
            what.getByText(staffCopy("trips.clock.wrapped.items", { count: 1 })),
          ).toBeVisible();
          await capture(page, "trip-wrapped-records", scheme);
        });
      }
    });
  });
}
