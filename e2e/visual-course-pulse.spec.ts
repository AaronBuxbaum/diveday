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
});
