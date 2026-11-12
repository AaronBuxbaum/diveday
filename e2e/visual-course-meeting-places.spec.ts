import {
  authorCourseMeetingPlaces,
  enrollWithCourseMeetingPlaces,
} from "./course-meeting-places-helpers";
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
  test("the course editor and student show authored meeting places (light)", async ({
    privateShop,
    page,
  }) => {
    await authorCourseMeetingPlaces(page, privateShop.slug);
    await capture(page, "course-meeting-place-editor", "light");
    await enrollWithCourseMeetingPlaces(page, privateShop.slug);
    await capture(page, "course-meeting-place-ready", "light");
  });
});
