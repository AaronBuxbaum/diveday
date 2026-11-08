import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");

test("staff record, correct and delete measured conservation actions after a departure", async ({
  page,
}) => {
  const title = "Recorded cleanup departure";
  await createTrip(page, {
    title,
    date: daysFromNow(-2),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 6,
  });
  const path = await tripPathByTitle(page, "blue-mantis", title, { daysOut: -2 });
  await page.goto(`${path}?view=details`);
  await expect(page.getByRole("heading", { name: t("trips.conservation.heading") })).toBeVisible();
  const add = page.locator("#conservation-add");
  await add.locator("summary").click();
  await add.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("2.5");
  await add.getByRole("textbox", { name: t("trips.conservation.location") }).fill("Molasses Reef");
  await add
    .getByRole("textbox", { name: t("trips.conservation.note") })
    .fill("Collected during the reef dive.");
  await add.getByRole("button", { name: t("trips.conservation.add"), exact: true }).click();
  const item = page
    .locator("li")
    .filter({ hasText: "Collected during the reef dive." })
    .filter({ has: page.locator('details[id^="conservation-"]') });
  await expect(item).toHaveCount(1);
  await item.locator("summary").click();
  await item.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("3.25");
  await item.getByRole("button", { name: t("trips.conservation.save"), exact: true }).click();
  await expect(item.locator("p").first()).toContainText("3.25");
  await page.reload();
  await expect(item.locator("p").first()).toContainText("3.25");
  await item.locator("summary").click();
  page.once("dialog", (dialog) => dialog.accept());
  await item.getByRole("button", { name: t("trips.conservation.delete"), exact: true }).click();
  await expect(page.getByText(t("trips.conservation.empty"), { exact: true })).toBeVisible();
  await expect(item).toHaveCount(0);
});
