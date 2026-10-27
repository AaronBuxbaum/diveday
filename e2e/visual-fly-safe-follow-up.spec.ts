import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = staffTranslator("en-US");

test.describe("light mode", () => {
  test.use({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    privateShopSlug: "flying-follow-up-visual",
  });
  test("staff see queued and unresolved flying guidance and can mark follow-up resolved", async ({
    page,
    request,
    privateShop,
  }) => {
    const seeded = await request.post(
      `/api/test/seed-trouble-states?flySafeFollowUp=1&shop=${privateShop.slug}`,
    );
    expect(seeded.ok()).toBe(true);
    const { flySafeFollowUp } = (await seeded.json()) as {
      flySafeFollowUp: { tripId: string; otherTripId: string };
    };
    await page.goto(`/shop/${privateShop.slug}/trips/${flySafeFollowUp.tripId}`);
    const panel = page.getByRole("region", { name: t("trips.flySafeFollowUp.heading") });
    const queued = panel.getByRole("listitem").filter({ hasText: "Queue Diver" });
    const followUp = panel.getByRole("listitem").filter({ hasText: "Contact Diver" });
    await expect(queued).toContainText(t("trips.flySafeFollowUp.queued"));
    await expect(followUp).toContainText(t("trips.flySafeFollowUp.contact"));
    await expect(queued.getByRole("link")).toHaveCount(0);
    await expect(followUp.getByRole("link", { name: "Other flying day" })).toHaveAttribute(
      "href",
      `/shop/${privateShop.slug}/trips/${flySafeFollowUp.otherTripId}`,
    );
    await capture(page, "trip-flying-guidance-follow-up", "light", {
      beforeScreenshot: async () => {
        const buttons = panel.getByRole("button");
        await expect(buttons).toHaveCount(2);
        for (const button of await buttons.all()) {
          const box = await button.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(
            await button.evaluate((element) =>
              Number.parseFloat(getComputedStyle(element).fontSize),
            ),
          ).toBeGreaterThanOrEqual(16);
        }
      },
    });
    // Exercise acknowledgement on the phone viewport as well as the captured desktop.
    await page.setViewportSize({ width: 390, height: 844 });

    await queued
      .getByRole("button", { name: t("trips.flySafeFollowUp.resolveFor", { name: "Queue Diver" }) })
      .click();
    await expect(queued).toHaveCount(0);
    await expect(followUp).toBeVisible();
    await page.reload();
    await expect(queued).toHaveCount(0);
    await expect(followUp).toBeVisible();
    await followUp
      .getByRole("button", {
        name: t("trips.flySafeFollowUp.resolveFor", { name: "Contact Diver" }),
      })
      .click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(panel).toHaveCount(0);
  });
});
