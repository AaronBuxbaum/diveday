import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

/**
 * The page a prospect's preview link opens once its week is up (ADR
 * 20261116-demo-previews). The live link's own page enters the shop the moment
 * it runs, so the ended state is the one a person reads.
 */
installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const copy = diverTranslator("en-US");

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.describe("public", () => {
      test.use({ colorScheme: scheme, storageState: { cookies: [], origins: [] } });
      test("an ended demo preview", async ({ page, request }) => {
        const {
          demoPreview: { id },
        } = await seedFacts(request, [
          { name: "demoPreview", shopName: "Reef Line Divers", ended: true },
        ]);
        await page.goto(`/preview/${id}`);
        await expect(
          page.getByRole("heading", { name: copy("demoPreview.endedTitle") }),
        ).toBeVisible();
        await capture(page, "demo-preview-ended", scheme);
      });
    });
  });
}
