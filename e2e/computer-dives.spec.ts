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
  await page.goto("/shop/blue-mantis/divers?q=Amara");
  await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
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
  await history.locator("summary").filter({ hasText: "2031-10-14T23:40:00" }).click();
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
  const summaryPromise = page.waitForEvent("download");
  await history.getByRole("button", { name: t("computerDives.exportCsv"), exact: true }).click();
  expect((await summaryPromise).suggestedFilename()).toBe("computer-dives.csv");
  await page.getByRole("button", { name: t("computerDives.importMore"), exact: true }).click();
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
    await page.goto("/shop/blue-mantis/divers?q=Amara");
    await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
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
    await expect(
      page.getByText(t("computerDives.warningCodes.timezone_unknown"), { exact: true }).first(),
    ).toBeVisible();
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
  await page.goto("/shop/blue-mantis/divers?q=Amara");
  await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
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
  await page.getByRole("button", { name: t("computerDives.importMore"), exact: true }).click();
  const history = page.getByRole("region", { name: t("computerDives.history") });
  await expect(history.locator("details")).toHaveCount(1);
  await history.locator("summary").filter({ hasText: "2000-01-01T00:00:00.000Z" }).click();
  await expect(history.getByRole("img", { name: t("computerDives.profile") })).toBeVisible();
  await expect(
    history.getByText(`${t("computerDives.samples")}: 3267`, { exact: true }),
  ).toBeVisible();
  await expect(history.getByText("2000-01-01T00:00:00.000Z", { exact: true })).toBeVisible();
  await expect(
    history.getByText(t("computerDives.warningCodes.unmapped_fit_fields"), { exact: true }),
  ).toBeVisible();
});

test("ZIP import rejects an empty archive and preserves preview-only behavior for extracted UDDF", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Amara");
  await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  await expect(page.getByText(t("computerDives.zipHint"), { exact: true })).toBeVisible();
  // An empty ZIP has no importable dives. It must not create history.
  const emptyZip = Buffer.alloc(22);
  emptyZip.writeUInt32LE(0x06054b50);
  await page
    .getByLabel(t("computerDives.files"), { exact: true })
    .setInputFiles({ name: "download.zip", mimeType: "application/zip", buffer: emptyZip });
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByText(t("computerDives.fileErrorCodes.no_dives"), { exact: false }),
  ).toBeVisible();
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

for (const locale of ["en-US", "es-ES"] as const) {
  test.describe(`online logbook beta guidance ${locale}`, () => {
    test.use({ locale });
    test("PADI and SSI explain the manual transfer without a connected account", async ({
      page,
    }) => {
      const words = staffTranslator(locale);
      await page.goto("/shop/blue-mantis/divers?q=Amara");
      await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
      await page.getByRole("link", { name: words("computerDives.title"), exact: true }).click();
      const source = page.getByLabel(words("computerDives.provider"), { exact: true });
      for (const provider of ["padi", "ssi"] as const) {
        await source.selectOption(provider);
        await expect(
          page.getByText(words(`computerDives.providers.${provider}.hint`), { exact: true }),
        ).toBeVisible();
        await expect(source.locator(`option[value="${provider}"]`)).toHaveText(
          `${words(`computerDives.providers.${provider}.label`)} · ${words("computerDives.beta")}`,
        );
        await expect(
          page.getByRole("link", { name: words("computerDives.providerGuide"), exact: true }),
        ).toHaveAttribute(
          "href",
          provider === "padi"
            ? "https://www.padi.com/scuba-diving-mobile-apps"
            : "https://www.divessi.com/en/blog/blog/blog/scubapro-logtrak-myssi-app-integration-10251.html",
        );
      }
      const guideTarget = await page
        .getByRole("link", { name: words("computerDives.providerGuide"), exact: true })
        .boundingBox();
      expect(guideTarget?.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByText(words("computerDives.betaHint"), { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: words("computerDives.empty"), exact: true }),
      ).toBeVisible();
    });
  });
}

test("manual CSV transfer requires explicit mapping and preserves a date without an invented time", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Amara");
  await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  await page.getByLabel(t("computerDives.provider"), { exact: true }).selectOption("padi");
  await page.getByLabel(t("computerDives.files"), { exact: true }).setInputFiles({
    name: "my-records.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Minutes,Feet,Entry\n14/10/2031,30,60,manual-e2e\n"),
  });
  await page.getByRole("checkbox", { name: t("computerDives.mapCsv"), exact: true }).check();
  const date = page.getByLabel(t("computerDives.mapping.date"), { exact: true });
  await expect(date).toBeEnabled();
  const preview = page.getByRole("button", { name: t("computerDives.preview"), exact: true });
  await expect(preview).toBeDisabled();
  await date.selectOption("Date");
  await page.getByLabel(t("computerDives.mapping.dateFormat"), { exact: true }).selectOption("dmy");
  await page
    .getByLabel(t("computerDives.mapping.duration"), { exact: true })
    .selectOption("Minutes");
  await page.getByLabel(t("computerDives.mapping.maxDepth"), { exact: true }).selectOption("Feet");
  await page.getByLabel(t("computerDives.mapping.sourceId"), { exact: true }).selectOption("Entry");
  await expect(preview).toBeDisabled();
  await expect(
    page.getByLabel(t("computerDives.mapping.durationUnit"), { exact: true }),
  ).toHaveValue("");
  await expect(page.getByLabel(t("computerDives.mapping.depthUnit"), { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel(t("computerDives.mapping.durationUnit"), { exact: true })
    .selectOption("minutes");
  await page.getByLabel(t("computerDives.mapping.depthUnit"), { exact: true }).selectOption("ft");
  await preview.click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeFocused();
  await expect(page.getByRole("checkbox", { name: /2031-10-14/ })).toBeChecked();
  await expect(
    page.getByText(t("computerDives.warningCodes.date_only"), { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(t("computerDives.warningCodes.timezone_unknown"), { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel(t("computerDives.offset"), { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(t("computerDives.provider"), { exact: true })).toBeDisabled();
  await expect(
    page.getByLabel(t("computerDives.mapping.depthUnit"), { exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: t("computerDives.confirmZone"), exact: true }).check();
  await page.getByRole("checkbox", { name: new RegExp(t("computerDives.confirmTarget")) }).check();
  await page.getByRole("button", { name: t("computerDives.commit"), exact: true }).click();
  await expect(page.getByText(t("computerDives.done"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.importMore"), exact: true }).click();
  await expect(page.getByLabel(t("computerDives.files"), { exact: true })).toBeFocused();
  const history = page.getByRole("region", { name: t("computerDives.history") });
  const imported = history.locator("summary").filter({ hasText: "2031-10-14" });
  await expect(imported).toHaveCount(1);
  await imported.click();
  await expect(
    history.getByText(`${t("computerDives.providers.padi.label")} · ${t("computerDives.beta")}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(history.getByText(t("computerDives.unknownTime"), { exact: true })).toBeVisible();
  await expect(history.getByText("1800", { exact: true })).toBeVisible();
  await expect(history.getByText("18.288", { exact: true })).toBeVisible();
  await expect(history.getByText("csv", { exact: true })).toBeVisible();
});

test("multi-entry ZIP preview cancels without saving and extracted files deduplicate after import", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers?q=Amara");
  await page.getByRole("link", { name: "Amara Osei", exact: true }).click();
  await page.getByRole("link", { name: t("computerDives.title"), exact: true }).click();
  const files = page.getByLabel(t("computerDives.files"), { exact: true });
  await files.setInputFiles("src/lib/computer-import/fixtures/multi-entry.zip");
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("computerDives.previewHeading") }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(t("computerDives.selected")) }),
  ).toHaveCount(2);
  await expect(
    page.getByText(t("computerDives.zipIgnored"), { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: t("computerDives.empty"), exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.cancel"), exact: true }).click();
  await expect(files).toBeFocused();
  await expect(files).toHaveValue("");
  await files.setInputFiles("src/lib/computer-import/fixtures/multi-entry.zip");
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  const timezoneReviews = page.getByRole("checkbox", {
    name: t("computerDives.confirmZone"),
    exact: true,
  });
  await expect(timezoneReviews).toHaveCount(2);
  await timezoneReviews.nth(0).check();
  await timezoneReviews.nth(1).check();
  await page.getByRole("checkbox", { name: new RegExp(t("computerDives.confirmTarget")) }).check();
  await page.getByRole("button", { name: t("computerDives.commit"), exact: true }).click();
  await expect(page.getByText(t("computerDives.done"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t("computerDives.importMore"), exact: true }).click();
  await expect(
    page.getByRole("region", { name: t("computerDives.history") }).locator("details"),
  ).toHaveCount(2);
  await files.setInputFiles("src/lib/computer-import/fixtures/si.uddf");
  await page.getByRole("button", { name: t("computerDives.preview"), exact: true }).click();
  await expect(page.getByText(t("computerDives.exact"), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(t("computerDives.selected")) }),
  ).toBeDisabled();
});
