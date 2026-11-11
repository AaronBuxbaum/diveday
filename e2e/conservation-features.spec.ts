import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { createTrip, daysFromNow, tripPathByTitle } from "./helpers";

const t = staffTranslator("en-US");

test("the owner hides and restores conservation without losing recorded actions", async ({
  page,
  privateShop,
}) => {
  // Minting a private shop, scheduling and two feature saves take about 30s locally.
  test.setTimeout(60_000);
  const title = "Conservation switch departure";
  await createTrip(page, {
    title,
    date: daysFromNow(-2),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 6,
    shopSlug: privateShop.slug,
  });
  const path = await tripPathByTitle(page, privateShop.slug, title, { daysOut: -2 });
  await page.goto(`${path}?view=details`);
  const add = page.locator("#conservation-add");
  await add.locator("summary").click();
  await add.getByRole("spinbutton", { name: t("trips.conservation.quantity") }).fill("1");
  await add
    .getByRole("textbox", { name: t("trips.conservation.location") })
    .fill("Recorded cleanup site");
  await add.getByRole("button", { name: t("trips.conservation.add"), exact: true }).click();
  await expect(page.getByText(/Recorded cleanup site/).first()).toBeVisible();
  await page.goto(`/shop/${privateShop.slug}/settings/features`);
  await page.locator("#conservation").getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: t("settings.main.features.save"), exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t("settings.main.features.saved") }),
  ).toBeVisible();
  await page.goto(`${path}?view=details`);
  await expect(
    page
      .locator("#about #conservation")
      .getByText(t("trips.conservation.heading"), { exact: true }),
  ).toHaveCount(0);
  await page.goto(`/shop/${privateShop.slug}/settings/features`);
  await page.locator("#conservation").getByRole("checkbox").check();
  await page.getByRole("button", { name: t("settings.main.features.save"), exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t("settings.main.features.saved") }),
  ).toBeVisible();
  await page.goto(`${path}?view=details`);
  await expect(
    page
      .locator("#about #conservation")
      .getByText(t("trips.conservation.heading"), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Recorded cleanup site/).first()).toBeVisible();
});
