import { expect, signedInAsOwner, test } from "./fixtures";
import { seededTripId, walkInFormPath } from "./helpers";
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
    test.describe("staff", () => {
      test(`the party waiver queue shows each person's next step (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
        await page.goto(walkInFormPath("blue-mantis", tripId));
        await page.getByLabel("Full name").first().fill("Alex Lagoon");
        await page.getByRole("button", { name: "Add another person" }).click();
        const child = page.getByRole("group", { name: "Person 2" });
        await child.getByLabel("Full name").fill("Sky Lagoon");
        await child.getByLabel(/Under 18/).check();
        await page.getByRole("button", { name: "Add to boat" }).click();
        await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers$/);
        await expect(page.getByText("Sky Lagoon", { exact: true })).toBeVisible();
        // No QR is opened: the screenshot never contains a live bearer credential.
        await capture(page, "party-waiver-queue", scheme);
      });
    });
  });
}
