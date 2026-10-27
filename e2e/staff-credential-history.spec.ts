import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const t = staffTranslator("en-US");

test("a shop corrects and renews a crew credential on the same card", async ({
  page,
  privateShop,
}) => {
  // This fixture creates a private shop and the flow makes two real saves.
  test.setTimeout(60_000);
  const team = `/shop/${privateShop.slug}/settings/team`;
  await page.goto(team);
  const ledger = page.locator('details[id^="credentials-"]').first();
  await ledger.locator(":scope > summary").click();
  const first = ledger.locator("li").first();
  const name = await first.locator("span.font-medium").first().innerText();
  const personId = await ledger
    .locator('xpath=ancestor::li[starts-with(@id,"staff-")][1]')
    .getAttribute("id");
  const person = page.locator(`[id="${personId}"]`);
  const row = person.locator("li").filter({ hasText: name }).first();
  const openRow = async () => {
    if (!(await row.isVisible())) {
      await person.locator('details[id^="credentials-"] > summary').click();
    }
    await row.getByText(t("staffing.credentials.editOrRenew")).click();
  };
  await row.getByText(t("staffing.credentials.editOrRenew")).click();
  await row.getByLabel(t("staffing.credentials.issuedAt")).fill("2024-01-01");
  await row.getByLabel(t("staffing.credentials.renewsAt")).fill("2027-07-20");
  await row.getByRole("button", { name: t("staffing.credentials.saveCorrection") }).click();
  await expect(page).toHaveURL(/notice=credential-corrected/);
  await page.goto(team);
  await openRow();
  await row.getByLabel(t("staffing.credentials.issuedAt")).fill("2026-07-20");
  await row.getByLabel(t("staffing.credentials.renewsAt")).fill("2029-07-20");
  await row.getByRole("button", { name: t("staffing.credentials.saveRenewal") }).click();
  await expect(page).toHaveURL(/notice=credential-renewed/);
  await page.goto(team);
  await openRow();
  await expect(row.getByLabel(t("staffing.credentials.renewsAt"))).toHaveValue("2029-07-20");
});
