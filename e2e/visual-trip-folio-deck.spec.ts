import { DEMO_TODAY_TRIP_ID } from "../src/db/seed/identifiers";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openCounterFor, openDeckPerson, openGuestFolio } from "./helpers";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  liveRosterConfirmation,
  SURFACE_TIMEOUT_MS,
  settleOfflineShellWorker,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = staffTranslator("en-US");
const trip = `/shop/blue-mantis/trips/${DEMO_TODAY_TRIP_ID}`;
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      signedInAsOwner();
      test(`guest list shows photos and initials (${scheme})`, async ({ page }) => {
        await page.goto(trip);
        const priya = page.getByRole("button", { name: "Priya Sharma", exact: true });
        await expect(priya.locator('img[src*="priya-sharma"]')).toBeVisible();
        await expect(page.getByRole("button", { name: "Lena Fischer", exact: true })).toContainText(
          "LF",
        );
        await capture(page, "trip-guest-photos", scheme);
      });
      test(`guest folio keeps independent requirements together (${scheme})`, async ({ page }) => {
        await page.goto(trip);
        await openGuestFolio(page, "Priya Sharma");
        await expect(page.locator("[data-guest-folio]")).toBeVisible();
        await expect(page.locator('[data-guest-folio] img[src*="priya-sharma"]')).toBeVisible();
        await capture(page, "trip-guest-folio", scheme);
      });
      test(`guest folio keeps multiple blockers and remedies visible (${scheme})`, async ({
        page,
      }) => {
        await openCounterFor(page, "blue-mantis", "Tomás Ferreira");
        await openGuestFolio(page, "Tomás Ferreira");
        const folio = page.locator("[data-guest-folio]");
        await expect(folio.getByText("Payment is outstanding for this trip.")).toBeVisible();
        await expect(folio.getByText("Waiver not signed. Not sent yet.")).toBeVisible();
        await capture(page, "trip-guest-folio-multiple-blockers", scheme);
      });
      test(`Deck records a named person through a separate receipt (${scheme})`, async ({
        page,
      }) => {
        const confirmed = liveRosterConfirmation(page);
        await page.goto(`${trip}/manifest?checkpoint=after_dive_1`);
        await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
        await confirmed;
        await capture(page, "trip-deck-home", scheme);
        await openDeckPerson(page, "Tom Okafor");
        await capture(page, "trip-deck-person", scheme);
        const afterRecord = liveRosterConfirmation(page);
        await page
          .getByRole("button", {
            name: t("manifest.deck.record", { name: "Tom Okafor" }),
            exact: true,
          })
          .click();
        await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
        await afterRecord;
        await capture(page, "trip-deck-receipt", scheme);
      });
      test.describe("isolated operational fixture", () => {
        test.use({
          storageState: { cookies: [], origins: [] },
          privateShopSlug: "deck-offline-receipt",
        });
        test(`offline Deck keeps the named local receipt visible (${scheme})`, async ({
          page,
          context,
          request,
          privateShop,
        }) => {
          const { operationalTrust: ready } = await seedFacts(
            request,
            [{ name: "operationalTrust", state: "capacity" }],
            { slug: privateShop.slug },
          );
          const name = ready.seats[0].fullName;
          await page.goto(
            `/shop/${privateShop.slug}/trips/${ready.tripId}/manifest?checkpoint=after_dive_1`,
          );
          await offlineCopySaved(page);
          await settleOfflineShellWorker(page);
          await page.goto(`/offline-manifest?trip=${ready.tripId}&checkpoint=after_dive_1`);
          await expect(page).toHaveURL(/offline-manifest/);
          await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
          await context.setOffline(true);
          await openDeckPerson(page, name);
          await page
            .getByRole("button", {
              name: t("manifest.deck.record", { name }),
              exact: true,
            })
            .click();
          await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
          await capture(page, "trip-deck-offline-receipt", scheme);
        });
      });
    });
  });
}
