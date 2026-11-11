import { enrollInMultiDayCourse, openMultiDayCourseBooking } from "./course-prep-helpers";
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
  test("the multi-day course booking presents the course plan (light)", async ({ page }) => {
    await openMultiDayCourseBooking(page);
    await capture(page, "course-multi-day-booking", "light");
  });
  test("the enrolled student sees every course meeting (light)", async ({ page }) => {
    await enrollInMultiDayCourse(page);
    await capture(page, "course-multi-day-ready", "light");
  });
});
