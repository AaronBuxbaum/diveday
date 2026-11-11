import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { bookASeatAndOpenThread, openThreadStep } from "./helpers";

const t = diverTranslator("en-US");

test("a new course student is given the personal kit online and in the saved prep copy", async ({
  page,
  request,
}) => {
  await page.goto("/s/blue-mantis/courses/discover-scuba-diving");
  await page.getByRole("link", { name: "Book this date" }).first().click();
  const facts = page.getByRole("region", { name: t("trip.goodToKnow") });
  const supplied = facts.getByText(t("trip.packProvided"), { exact: true }).locator("..");
  const coursePlan = page.getByTestId("trip-course-plan").filter({ visible: true });
  await expect(coursePlan).toHaveCount(1);
  for (const key of ["trip.personalGear.snorkel", "trip.personalGear.boots"] as const) {
    await expect(supplied.getByText(t(key), { exact: true })).toBeVisible();
    await expect(coursePlan).not.toContainText(t(key));
  }
  await bookASeatAndOpenThread(page, "Personal Kit Student");
  const provided = page.getByRole("heading", { name: t("trip.packProvided") }).locator("..");
  const bring = page.getByRole("heading", { name: t("trip.packBring"), exact: true }).locator("..");
  for (const key of ["trip.personalGear.snorkel", "trip.personalGear.boots"] as const) {
    await expect(provided).toContainText(t(key));
    await expect(bring).not.toContainText(t(key));
  }
  const gear = await openThreadStep(page, "gear");
  await expect(gear.getByText(/^Included with the course:/)).toContainText(
    t("trip.personalGear.boots"),
  );
  await expect(
    gear.getByRole("textbox", {
      name: `${t("rental.bootSize")} ${t("common.optional")}`,
      exact: true,
    }),
  ).toBeVisible();
  const response = await request.get(`${new URL(page.url()).pathname}/offline`);
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  expect(snapshot.saved).not.toContain(t("trip.personalGear.snorkel"));
  expect(snapshot.saved).not.toContain(t("trip.personalGear.boots"));
});
