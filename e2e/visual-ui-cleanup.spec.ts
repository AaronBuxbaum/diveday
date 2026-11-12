import { expect, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, seededTripId } from "./helpers";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
test.describe("light mode", () => {
  signedInAsOwner();
  test("UI cleanup navigation", async ({ page }) => {
    await page.goto("/shop/blue-mantis/inbox");
    await expect(page.locator("[data-staff-tabbar]")).toHaveAttribute("data-hydrated", "true");
    await capture(page, "ui-cleanup-navigation", "light");
  });
  test("UI cleanup expanded past divers", async ({ page }) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — French Reef");
    await page.goto(`/shop/blue-mantis/trips/${id}`);
    const initial = page.getByTestId("invite-suggestions");
    await expect(initial).toBeVisible();
    const details = initial.locator("+ details");
    await details.locator("summary").click();
    await expect(details.locator("li").first()).toBeVisible();
    await capture(page, "ui-cleanup-past-divers", "light");
  });
  test("UI cleanup manifest stages", async ({ page }) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
    await offlineCopySaved(page);
    await expect(page.getByRole("region", { name: "Where the boat is" })).toBeVisible();
    await capture(page, "ui-cleanup-manifest-stages", "light");
  });
});

test.describe("dark mode", () => {
  signedInAsOwner();
  test.use({ colorScheme: "dark" });
  test("UI cleanup manifest stages", async ({ page }) => {
    const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
    await offlineCopySaved(page);
    await expect(page.getByRole("region", { name: "Where the boat is" })).toBeVisible();
    await capture(page, "ui-cleanup-manifest-stages", "dark", { darkPhone: true });
  });
});
