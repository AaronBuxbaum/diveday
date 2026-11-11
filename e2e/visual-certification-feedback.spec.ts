import { checkLowerCardRoster, submitLowerCard } from "./certification-feedback-helpers";
import { test } from "./fixtures";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.use({
  ...VISUAL_STEP_BOUNDS,
  colorScheme: "light",
  viewport: { width: 1280, height: 800 },
  privateShopSlug: "certification-feedback-visual",
});
test.describe("light mode", () => {
  test("saved lower certification feedback on the diver page and roster", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const { tripId } = await submitLowerCard(page, privateShop.slug);
    await capture(page, "ready-lower-certification-saved", "light");
    await checkLowerCardRoster(page, privateShop.slug, tripId);
    await capture(page, "roster-lower-certification-unverified", "light");
  });
});
