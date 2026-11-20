/**
 * Spanish at phone width: the diver's public pages and the staff's daily pages.
 *
 * Spanish runs about a quarter longer than English, which is where a fixed-width table, a
 * squeezed title or a button row first overflows; only 52 of the suite's captures were
 * Spanish before this file (the pricing page overflowed at 390 for exactly that reason).
 * One of the per-feature `e2e/visual-*.spec.ts` files; the mechanics are
 * `e2e/visual-harness.ts`, the procedure is the e2e-and-visual skill.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { openNamedScheduleTrip, openTripFromBoard } from "./helpers";
import {
  capture,
  installVisualBuildGuard,
  publicReefCard,
  REEF_TRIP,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({ ...VISUAL_STEP_BOUNDS, locale: SPANISH, colorScheme: "light" });
const photograph = (page: Parameters<typeof capture>[0], name: string) =>
  capture(page, name, "light", { locale: SPANISH });

test.describe("the diver's public pages in Spanish", () => {
  test("schedule, trip, courses, sites, reviews and packages", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    await publicReefCard(page).getByRole("link").waitFor();
    await publicReefCard(page).locator("[data-schedule-fact]").waitFor();
    await photograph(page, "phone-schedule");

    await openNamedScheduleTrip(page, REEF_TRIP, SPANISH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-public-trip");

    await page.goto("/s/blue-mantis/courses");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-public-courses");

    await page.goto("/s/blue-mantis/sites");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-public-sites");

    await page.goto("/s/blue-mantis/reviews");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-public-reviews");

    await page.goto("/s/blue-mantis/packages");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-public-packages");
  });
});

test.describe("the staff's daily pages in Spanish", () => {
  signedInAsOwner();
  test("today, schedule, divers, gear, orders, inbox and a trip", async ({ page }) => {
    for (const [path, name] of [
      ["/shop/blue-mantis", "phone-staff-today"],
      ["/shop/blue-mantis/schedule", "phone-staff-schedule"],
      ["/shop/blue-mantis/divers", "phone-staff-divers"],
      ["/shop/blue-mantis/gear", "phone-staff-gear"],
      ["/shop/blue-mantis/orders", "phone-staff-orders"],
      ["/shop/blue-mantis/inbox", "phone-staff-inbox"],
      ["/shop/blue-mantis/courses", "phone-staff-courses"],
      ["/shop/blue-mantis/dive-sites", "phone-staff-dive-sites"],
      ["/shop/blue-mantis/settings", "phone-staff-settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await photograph(page, name);
    }
    await page.goto("/shop/blue-mantis/schedule");
    await openTripFromBoard(page, REEF_TRIP);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await photograph(page, "phone-staff-trip");
  });
});
