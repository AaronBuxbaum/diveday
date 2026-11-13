import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow } from "./helpers";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
signedInAsOwner();
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test(`day schedule with a roster open (${scheme})`, async ({ page }) => {
      const day = daysFromNow(0);
      await createTrip(page, {
        title: "Afternoon day view",
        date: day,
        departsAt: "15:00",
        returnsAt: "17:00",
        capacity: 8,
        price: 120,
      });
      await page.goto(`/shop/blue-mantis/schedule/board?view=day&day=${day}`);
      await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
      await page.locator("summary").filter({ hasText: /^Crew/ }).first().click();
      await capture(page, "schedule-day-roster", scheme);
    });
  });
}
