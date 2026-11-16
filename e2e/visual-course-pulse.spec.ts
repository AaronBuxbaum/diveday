import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripTab, tripPathByTitle } from "./helpers";
import { capture, installVisualBuildGuard, SURFACE_TIMEOUT_MS } from "./visual-harness";

installVisualBuildGuard();
signedInAsOwner();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
const t = staffTranslator("en-US");

test("course preparation and a private teaching note (light)", async ({ page }) => {
  const path = await tripPathByTitle(page, "blue-mantis", /Advanced Open Water Diver/, {
    daysOut: 29,
  });
  await page.goto(path);
  await openTripTab(page, "Trip");
  await page
    .getByRole("textbox", { name: t("trips.coursePulse.noteLabel") })
    .fill(
      "Focus on buoyancy before navigation. Review compass headings together before the next dive.",
    );
  await page.getByRole("button", { name: t("trips.coursePulse.save"), exact: true }).click();
  await expect(page.getByText(t("trips.coursePulse.saved"), { exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("status").filter({ hasText: t("trips.coursePulse.saved") }),
  ).toBeHidden();
  await capture(page, "course-preparation-note", "light");
  const section = page.locator('section[aria-labelledby="course-preparation"]');
  await section
    .getByRole("button", { name: /Take follow-up for / })
    .first()
    .click();
  await expect(
    section.getByText(t("trips.coursePulse.followup.inProgress"), { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "course-preparation-followup-phone", "light");
  await page.setViewportSize({ width: 1280, height: 800 });
  await capture(page, "course-preparation-followup-desktop", "light");
});
