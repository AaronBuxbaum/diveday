/** Actual opposing marks stay visible on the live manifest and saved phone copy. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { offlineCopySaved } from "./helpers";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

const staff = staffTranslator("en-US");
installVisualBuildGuard();
test.use(VISUAL_STEP_BOUNDS);
test.describe("light mode", () => {
  for (const role of ["diver", "crew"] as const) {
    test.describe(`${role} conflict`, () => {
      test.use({
        storageState: { cookies: [], origins: [] },
        colorScheme: "light",
        viewport: { width: 1280, height: 800 },
        privateShopSlug: `causal-${role}-visual`,
        privateShopFacts: [{ name: "causalRollCallConflict", role }],
      });
      test("shows both statements before a deliberate crew decision", async ({
        page,
        privateShop,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const fact = privateShop.values.causalRollCallConflict as {
          tripId: string;
          fullName: string;
          evidenceIds: string[];
        };
        expect(fact.evidenceIds).toHaveLength(2);
        await page.goto(
          `/shop/${privateShop.slug}/trips/${fact.tripId}/manifest?checkpoint=after_dive_1`,
        );
        const resolve = page.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        const panel = page.locator("details").filter({ has: resolve });
        await expect(resolve).toBeVisible();
        await expect(panel).toContainText(fact.fullName);
        await expect(panel).toContainText(staff("manifest.conflicts.aboard"));
        await expect(panel).toContainText(staff("manifest.conflicts.missing"));
        await expect(panel.locator("time").first()).toContainText(/\bEDT\b/);
        await capture(page, `roll-call-${role}-conflict-live`, "light", {
          beforeScreenshot: async () => {
            await expect(panel.locator("ul > li > p.font-medium")).toHaveText([
              staff("manifest.conflicts.missing"),
              staff("manifest.conflicts.aboard"),
            ]);
          },
        });

        await offlineCopySaved(page);
        await page.goto(`/offline-manifest?trip=${fact.tripId}&checkpoint=after_dive_1`);
        await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
        const savedResolve = page.getByRole("button", {
          name: staff("manifest.conflicts.confirmAboard"),
          exact: true,
        });
        const savedPanel = page.locator("details").filter({ has: savedResolve });
        await expect(savedResolve).toBeVisible();
        await expect(savedPanel).toContainText(fact.fullName);
        await expect(savedPanel).toContainText(staff("manifest.conflicts.aboard"));
        await expect(savedPanel).toContainText(staff("manifest.conflicts.missing"));
        await expect(savedPanel.locator("time").first()).toContainText(/\bEDT\b/);
        await capture(page, `roll-call-${role}-conflict-offline`, "light", {
          beforeScreenshot: async () => {
            // "ready" until the first sync answers; photograph the settled status line.
            await expect(
              page.getByRole("status").filter({ hasText: "Everything’s sent" }),
            ).toBeVisible();
            await expect(savedPanel.locator("ul > li > p.font-medium")).toHaveText([
              staff("manifest.conflicts.missing"),
              staff("manifest.conflicts.aboard"),
            ]);
          },
        });
      });
    });
  }
});
