import { test } from "./fixtures";
import { saveReadyRental } from "./ready-rental-price-helpers";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({ ...VISUAL_STEP_BOUNDS, colorScheme: "light", viewport: { width: 1280, height: 800 } });

test.describe("light mode", () => {
  test("the saved rental and at-shop estimate render clearly (light)", async ({ page }) => {
    await saveReadyRental(page);
    await page.goto(new URL(page.url()).pathname);
    await capture(page, "ready-saved-rental-estimate", "light");
  });
  test("the party estimate identifies whose gear it includes (light)", async ({ page }) => {
    await saveReadyRental(page, true);
    await page.goto(new URL(page.url()).pathname);
    await capture(page, "ready-party-rental-estimate", "light");
  });
});
