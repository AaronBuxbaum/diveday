import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { capturePrintPdfs } from "./print-pdf";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const staff = staffTranslator("en-US");

test.describe("mixed training depth warning", () => {
  signedInAsOwner();
  test("shows the conditional check on the roster and Boat manifest", async ({ page, request }) => {
    const response = await request.post("/api/test/seed-trouble-states?mixedDepth=1");
    expect(response.ok()).toBe(true);
    const { mixedDepth } = (await response.json()) as { mixedDepth: { tripId: string } };
    await page.goto(`/shop/blue-mantis/trips/${mixedDepth.tripId}`);
    await expect(page.getByText(staff("manifest.mixedTrainingDepthWarning"))).toBeVisible();
    const plan = page.locator("#training-plan");
    await expect(
      plan.getByRole("heading", { name: staff("trips.trainingPlan.title") }),
    ).toBeVisible();
    await expect(plan.getByText(staff("trips.trainingPlan.unresolved"))).toBeVisible();
    const student = plan.getByLabel(staff("trips.trainingPlan.instructor", { name: "Maya" }));
    await expect(student).toHaveValue("");
    await student
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: staff("trips.trainingPlan.save") })
      .click();
    await expect(page).toHaveURL(/#training-plan$/);
    await expect(
      plan.getByLabel(staff("trips.trainingPlan.instructor", { name: "Maya" })),
    ).toHaveValue("");
    await capture(page, "trip-mixed-training-depth-roster", "light", {
      beforeScreenshot: async () => {
        await expect(
          page.getByRole("alertdialog", { name: staff("shared.sessionIdle.title") }),
        ).toHaveCount(0);
        await expect(page.getByText(staff("manifest.mixedTrainingDepthWarning"))).toBeVisible();
      },
    });
    await page.goto(`/shop/blue-mantis/trips/${mixedDepth.tripId}/manifest`);
    await expect(page.getByText(staff("manifest.mixedTrainingDepthWarning"))).toBeVisible();
    await capture(page, "trip-mixed-training-depth-manifest", "light");
    await page.emulateMedia({ media: "print" });
    await capturePrintPdfs(page, "trip-mixed-training-depth-manifest");
  });
});
