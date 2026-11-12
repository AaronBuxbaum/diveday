import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const t = staffTranslator("en-US");

test("account settings owns public visibility, and crew can switch schedule scope", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const base = `/shop/${privateShop.slug}`;
  await page.goto(`${base}/settings`);
  await page.getByRole("link", { name: t("settings.security.title"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("settings.security.title"), exact: true }),
  ).toBeVisible();
  await page.getByText(t("staffing.crewConsent.rowLabel"), { exact: true }).click();
  const consent = page.getByRole("checkbox", { name: t("staffing.crewConsent.label") });
  await consent.check();
  await page
    .getByRole("textbox", { name: t("staffing.crewConsent.nameLabel") })
    .fill("Ocean Guide");
  await page.getByRole("button", { name: t("staffing.crewConsent.save"), exact: true }).click();
  await expect(page.getByText(t("staffing.notice.crewConsentSaved"))).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(t("staffing.crewConsent.shownAs", { name: "Ocean Guide" })),
  ).toBeVisible();
  await page.getByText(t("staffing.crewConsent.rowLabel"), { exact: true }).click();
  await consent.uncheck();
  await page.getByRole("button", { name: t("staffing.crewConsent.save"), exact: true }).click();
  await expect(page.getByText(t("staffing.notice.crewConsentWithdrawn"))).toBeVisible();
  await page.goto(`${base}/staffing`);
  await expect(page.getByText(t("staffing.crewConsent.rowLabel"), { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: t("staffing.filter.me"), exact: true }).click();
  await expect(page).toHaveURL(/person=me/);
  const scope = page.getByRole("navigation", { name: t("staffing.filter.label") });
  await expect(scope.getByText(t("staffing.filter.me"), { exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("combobox", { name: t("staffing.filter.person") })).toHaveValue("me");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: t("staffing.filter.all"), exact: true }).click();
  await expect(scope.getByText(t("staffing.filter.all"), { exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const selector = page.getByRole("combobox", { name: t("staffing.filter.person") });
  const other = await selector.locator("option").nth(2).getAttribute("value");
  if (!other) throw new Error("Expected another staff member");
  await selector.selectOption(other);
  await page.getByRole("button", { name: t("staffing.filter.show") }).click();
  await expect(page).toHaveURL(new RegExp(`person=${other}`));
});
