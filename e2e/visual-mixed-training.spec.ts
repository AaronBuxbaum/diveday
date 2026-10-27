import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
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

test.describe("mixed training advisory", () => {
  signedInAsOwner();
  test("shows a conditional prompt and links to the overlapping session", async ({
    page,
    request,
  }) => {
    const response = await request.post("/api/test/seed-trouble-states?mixedTraining=1");
    expect(response.ok()).toBe(true);
    const { mixedTraining } = (await response.json()) as {
      mixedTraining: { tripId: string; otherTripId: string };
    };
    await page.goto(`/shop/blue-mantis/trips/${mixedTraining.tripId}`);
    await expect(page.getByText(staff("trips.addDiver.mixedTrainingBody"))).toBeVisible();
    const other = page.getByRole("link", { name: "Open Water session" });
    await expect(other).toHaveAttribute(
      "href",
      `/shop/blue-mantis/trips/${mixedTraining.otherTripId}`,
    );
    await capture(page, "trip-mixed-training-advisory", "light");
    await other.click();
    await expect(page).toHaveURL(`/shop/blue-mantis/trips/${mixedTraining.otherTripId}`);
  });
});
