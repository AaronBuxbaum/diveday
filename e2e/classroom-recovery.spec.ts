import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";

const t = staffTranslator("en-US");
signedInAsOwner();
// story: DESK-12
test("DESK-12 arranges a separate complimentary classroom activity after cancellation", async ({
  page,
}) => {
  await createTrip(page, {
    title: "Classroom source",
    date: daysFromNow(9),
    departsAt: "08:00",
    returnsAt: "10:00",
    price: 120,
  });
  const path = await tripPathByTitle(page, "blue-mantis", "Classroom source");
  await page.goto(`${path}?blowout=1`);
  await page.getByRole("button", { name: t("blowout.confirm.button"), exact: true }).click();
  await expect(page.getByRole("heading", { name: t("blowout.record.title") })).toBeVisible();
  await page.getByText(t("blowout.classroom.add"), { exact: true }).click();
  await page
    .getByLabel(t("blowout.classroom.title"), { exact: true })
    .fill("Reef photography ashore");
  await page.getByLabel(t("blowout.classroom.date"), { exact: true }).fill(daysFromNow(10));
  await page.getByLabel(t("blowout.classroom.start"), { exact: true }).fill("09:00");
  await page.getByLabel(t("blowout.classroom.endDate"), { exact: true }).fill(daysFromNow(10));
  await page.getByLabel(t("blowout.classroom.end"), { exact: true }).fill("10:30");
  await page
    .getByLabel(t("blowout.classroom.location"), { exact: true })
    .fill("Shop classroom by the dock");
  await page.getByLabel(t("blowout.classroom.capacity"), { exact: true }).fill("8");
  await page
    .getByLabel(t("blowout.classroom.coordinator"), { exact: true })
    .selectOption({ label: "Dana Reyes" });
  await page.getByRole("checkbox", { name: t("blowout.classroom.attest"), exact: true }).check();
  await page.getByRole("button", { name: t("blowout.classroom.create"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Reef photography ashore", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(t("blowout.classroom.boundary"), { exact: true })).toBeVisible();
  await page.getByText(t("blowout.classroom.manage"), { exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: t("blowout.classroom.cancel") })
    .click();
  await page.getByRole("button", { name: t("blowout.classroom.cancel"), exact: true }).click();
  await expect(page.getByText(t("blowout.classroom.cancelled"), { exact: true })).toBeVisible();
});
