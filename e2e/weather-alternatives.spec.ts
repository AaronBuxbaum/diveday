import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripMore } from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");
// story: DESK-10
test("prioritizes an existing shore departure without moving the canceled booking", async ({
  page,
}) => {
  const setup = await page.request.post("/api/test/shop", {
    data: { facts: ["weatherAlternatives"] },
  });
  expect(setup.ok()).toBe(true);
  const { values } = await setup.json();
  const shore = "Weather alternative shore";
  await page.goto(`/shop/blue-mantis/trips/${values.weatherAlternatives.sourceTripId}`);
  await openTripMore(page);
  await page.getByRole("link", { name: "Call it off for weather" }).click();
  await page.getByText(t("blowout.alternatives.title"), { exact: true }).click();
  const option = page.getByRole("checkbox", { name: new RegExp(shore) });
  await expect(option).not.toBeChecked();
  await option.check();
  await page.getByRole("button", { name: t("blowout.confirm.button"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("blowout.record.title"), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(shore) })).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.locator(
          `a[href="/shop/blue-mantis/divers/${values.weatherAlternatives.personId}"]`,
        ),
      })
      .getByText(t("blowout.record.unresolvedBadge"), { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
