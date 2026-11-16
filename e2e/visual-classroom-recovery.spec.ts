import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
signedInAsOwner();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
const t = staffTranslator("en-US");
test("classroom recovery arrangements on phone and desktop (light)", async ({ page }) => {
  await createTrip(page, {
    title: "Classroom arrangement capture",
    date: daysFromNow(9),
    departsAt: "08:00",
    returnsAt: "10:00",
    price: 120,
  });
  await page.goto(
    `${await tripPathByTitle(page, "blue-mantis", "Classroom arrangement capture")}?blowout=1`,
  );
  await page.getByRole("button", { name: t("blowout.confirm.button"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("blowout.classroom.heading"), exact: true }),
  ).toBeVisible();
  await page.getByText(t("blowout.classroom.add"), { exact: true }).click();
  await page
    .getByLabel(t("blowout.classroom.title"), { exact: true })
    .fill("Reef photography in the classroom");
  await page
    .getByLabel(t("blowout.classroom.location"), { exact: true })
    .fill("The classroom beside the dock and equipment workshop");
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await capture(page, `classroom-recovery-${viewport.name}`, "light");
  }
});
