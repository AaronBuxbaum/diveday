import { expect, test } from "./fixtures";
import {
  bookUnnamedVisualGroup,
  capture,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("public", () => {
      test(`unnamed companions choose their seat (${scheme})`, async ({ page }) => {
        // Real booking plus both organizer and picker captures at the shared viewport matrix.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const groupPath = await bookUnnamedVisualGroup(page);
        await capture(page, "group-organizer-share", scheme);
        await page.goto(groupPath);
        await expect(
          page.getByRole("heading", { name: diverCopy("seatClaim.groupHeading") }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "Guest 2", exact: true })).toBeVisible();
        await capture(page, "group-seat-picker", scheme);
      });
    });
  });
}
