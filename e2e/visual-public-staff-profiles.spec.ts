/** Explicitly opted-in assigned instructor; pictures remain empty without a storage provider. */
import { expect, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({
  ...VISUAL_STEP_BOUNDS,
  colorScheme: "light",
  privateShopSlug: "tidepool-coast-dive-co",
  privateShopFacts: ["publicStaffProfile"],
});
for (const surface of ["shopfront", "trip", "course"] as const) {
  test(`light mode public assigned staff introduction on ${surface}`, async ({
    page,
    privateShop,
  }) => {
    const fact = privateShop.values.publicStaffProfile as {
      tripId: string;
      courseSlug: string;
      firstName: string;
      description: string;
    };
    const base = `/s/${privateShop.slug}`;
    const path =
      surface === "trip"
        ? `${base}/trips/${fact.tripId}`
        : surface === "course"
          ? `${base}/courses/${fact.courseSlug}`
          : base;
    await page.goto(path);
    await expect(
      page.getByRole("link", { name: "Tidepool Coast Dive Co", exact: true }).first(),
    ).toBeVisible();
    // The trip's existing detail disclosure owns its introduction.
    const introduction = page.getByText(fact.description, { exact: true });
    if (surface === "trip") {
      const details = page.locator("details").filter({ hasText: fact.description });
      await details.locator(":scope > summary").click();
    }
    await expect(introduction).toBeVisible();
    // The fixture authors the role too; the component renders one name-and-role paragraph.
    // Assert that complete visible identity rather than looking for a nonexistent name-only node.
    await expect(page.getByText(`${fact.firstName} · Instructor`, { exact: true })).toBeVisible();
    await capture(page, `public-staff-profile-${surface}`, "light", {
      beforeScreenshot: async () => {
        await expect(
          page.getByRole("link", { name: "Tidepool Coast Dive Co", exact: true }).first(),
        ).toBeVisible();
      },
    });
  });
}
