import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

const t = staffTranslator("en-US");
const csv =
  "local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2031-10-14T23:40:00,unknown,Fixture Computer,fixture-e2e,1800,18\n";
const upload = { name: "computer-data.txt", mimeType: "text/plain", buffer: Buffer.from(csv) };
signedInAsOwner();

test("computer import previews, cancels, retries and restores a personal record", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  await expect(page).toHaveURL(/\/divers\/[a-f0-9-]+\/computer-dives$/);
  await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  await page.getByLabel(t("computerDives.files"), { exact: true }).setInputFiles(upload);
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeFocused();
  await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  await expect(page.getByLabel(t("computerDives.files"), { exact: true })).toBeFocused();
  await expect(page.getByLabel(t("computerDives.files"), { exact: true })).toHaveValue("");
  await page.getByLabel(t("computerDives.files"), { exact: true }).setInputFiles(upload);
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: t("computerDives.confirmZone"), exact: true }).check();
  await page.getByRole("checkbox", { name: new RegExp(t("computerDives.confirmTarget")) }).check();
  await page
    .getByRole("button", { name: t("computerDives.commit"), exact: true })
    .click({ clickCount: 2 });
  await expect(page.getByText(t("computerDives.done"), { exact: true })).toBeVisible();
  const history = page.getByRole("region", { name: t("computerDives.history") });
  await expect(history.locator("details")).toHaveCount(1);
  await page.getByRole("button", { name: t("computerDives.retry"), exact: true }).click();
  await expect(history.locator("details")).toHaveCount(1);
  await history.locator("summary").click();
  await history
    .getByLabel(t("computerDives.notes"), { exact: true })
    .fill("Device clock checked at the counter");
  await history.getByRole("button", { name: t("computerDives.save"), exact: true }).click();
  await expect(page.getByText(t("computerDives.saved"), { exact: true })).toBeVisible();
  await history.getByRole("button", { name: t("computerDives.delete"), exact: true }).click();
  await expect(
    history.getByRole("button", { name: t("computerDives.restore"), exact: true }),
  ).toBeVisible();
  await history.getByRole("button", { name: t("computerDives.restore"), exact: true }).click();
  await expect(
    history.getByRole("button", { name: t("computerDives.delete"), exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await history.getByRole("button", { name: t("computerDives.export"), exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("computer-dives.json");
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  await page.getByLabel(t("computerDives.files"), { exact: true }).setInputFiles(upload);
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(page.getByText(t("computerDives.exact"), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(t("computerDives.selected")) }),
  ).toBeDisabled();
});

test.describe("phone keyboard import", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("unknown timezone stays explicit and cancel returns focus", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers?q=Priya");
    await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
    await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
    await page.getByLabel(t("computerDives.files"), { exact: true }).setInputFiles(upload);
    await page
      .getByRole("button", { name: t("computerDives.preview"), exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", { name: t("computerDives.previewHeading") }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: t("computerDives.commit"), exact: true }),
    ).toBeDisabled();
    await page.getByLabel(t("computerDives.offset"), { exact: true }).fill("-300");
    await page.getByRole("checkbox", { name: t("computerDives.confirmZone"), exact: true }).check();
    await page.getByLabel(t("computerDives.offset"), { exact: true }).fill("-240");
    await expect(
      page.getByRole("checkbox", { name: t("computerDives.confirmZone"), exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).press("Enter");
    await expect(page.getByLabel(t("computerDives.files"), { exact: true })).toBeFocused();
    await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  });
});

test("Garmin FIT retains the UTC instant and profile without inventing a local timezone", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  await page
    .getByLabel(t("computerDives.files"), { exact: true })
    .setInputFiles("src/lib/computer-import/fixtures/garmin-connect-summary-first.fit");
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeFocused();
  await expect(
    page.getByText(t("computerDives.warningCodes.local_time_unknown"), { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /2000-01-01T00:00:00.000Z/ })).toBeChecked();
  await expect(page.getByLabel(t("computerDives.offset"), { exact: true })).toHaveCount(0);
  await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: t("computerDives.confirmZone"), exact: true }).check();
  await page.getByRole("checkbox", { name: new RegExp(t("computerDives.confirmTarget")) }).check();
  await page.getByRole("button", { name: t("computerDives.commit"), exact: true }).click();
  await expect(page.getByText(t("computerDives.done"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  const history = page.getByRole("region", { name: t("computerDives.history") });
  await expect(history.locator("details")).toHaveCount(1);
  await history.locator("summary").click();
  await expect(history.getByRole("img", { name: t("computerDives.profile") })).toBeVisible();
  await expect(
    history.getByText(`${t("computerDives.samples")}: 3267`, { exact: true }),
  ).toBeVisible();
  await expect(history.getByText("2000-01-01T00:00:00.000Z", { exact: true })).toBeVisible();
  await expect(
    history.getByText(t("computerDives.warningCodes.unmapped_fit_fields"), { exact: true }),
  ).toBeVisible();
});

test("ZIP guidance preserves preview-only behavior when choosing an extracted UDDF", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Priya");
  await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  await expect(page.getByText(t("computerDives.zipHint"), { exact: true })).toBeVisible();
  // A valid empty ZIP: archives are neither decoded nor retained by the import.
  const emptyZip = Buffer.alloc(22);
  emptyZip.writeUInt32LE(0x06054b50);
  await page
    .getByLabel(t("computerDives.files"), { exact: true })
    .setInputFiles({ name: "download.zip", mimeType: "application/zip", buffer: emptyZip });
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(page.getByText(t("computerDives.fileError"), { exact: false })).toBeVisible();
  await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: t("computerDives.commit"), exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  await page
    .getByLabel(t("computerDives.files"), { exact: true })
    .setInputFiles("src/lib/computer-import/fixtures/si.uddf");
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(t("computerDives.selected")) }),
  ).toBeChecked();
  await expect(page.getByText(t("computerDives.empty"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  await expect(page.getByLabel(t("computerDives.files"), { exact: true })).toBeFocused();
});
