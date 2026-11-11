import { openCardAtCheckIn, saveCardAtCheckIn } from "./card-at-checkin-helpers";
import { test } from "./fixtures";
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
  test("the unknown card number answer renders clearly (light)", async ({ page }) => {
    await openCardAtCheckIn(page);
    await capture(page, "ready-card-at-checkin-form", "light");
  });
  test("the declared card waits for the shop (light)", async ({ page }) => {
    await saveCardAtCheckIn(page);
    await capture(page, "ready-card-at-checkin-waiting", "light");
  });
});
