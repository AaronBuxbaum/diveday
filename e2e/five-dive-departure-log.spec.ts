import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures";
import { capturePrintPdfs } from "./print-pdf";

test.use({ privateShopSlug: "five-dive-print" });

test("five-dive departure log keeps the final head count on screen and paper", async ({
  page,
  request,
  privateShop,
}, testInfo) => {
  const response = await request.post(
    `/api/test/seed-trouble-states?fiveDivePrint=1&shop=${privateShop.slug}`,
  );
  expect(response.ok()).toBe(true);
  const { tripId } = await response.json();
  const sessionCheck = page.waitForResponse(
    (response) =>
      response.url().includes("/api/staff-activity") && response.request().method() === "GET",
  );
  await page.goto(`/shop/${privateShop.slug}/trips/${tripId}/log`);
  expect((await sessionCheck).ok()).toBe(true);
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "After dive 5" }).first()).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Ari Vale" }).getByText("Not back aboard"),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const contact = page
    .locator("tr:visible")
    .filter({ hasText: "Ari Vale" })
    .locator("span.whitespace-nowrap");
  await expect(contact).toHaveCount(3);
  const fits = await contact.evaluateAll((spans) =>
    spans.every((span) => {
      const cell = span.closest("td");
      return (
        cell !== null && span.getBoundingClientRect().right <= cell.getBoundingClientRect().right
      );
    }),
  );
  expect(fits).toBe(true);
  const pdfText = (file: string) =>
    execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", timeout: 30_000 });
  const pdfs = await capturePrintPdfs(page, "five-dive-log", testInfo.outputDir);
  for (const pdf of pdfs) {
    const text = pdfText(pdf);
    const pages = text.split("\f").filter((sheet) => sheet.trim());
    expect(pages.length).toBeGreaterThan(1);
    for (const sheet of pages) {
      expect(sheet).toContain("Operational trust departure");
      expect(sheet).toContain("Printed Jul");
    }
    expect(text).toContain("+1-305-555-0148");
    expect(text).toContain("Not back aboard");
    expect(text).not.toContain("Session paused");
  }
  await page.route("**/api/staff-activity", (route) => route.fulfill({ status: 401 }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational trust departure" })).toBeHidden();
  const lockedPath = testInfo.outputPath("locked.pdf");
  await page.pdf({ path: lockedPath, format: "Letter", printBackground: true });
  const lockedText = pdfText(lockedPath);
  expect(lockedText).toContain("Session paused");
  expect(lockedText).not.toContain("Ari Vale");
  expect(lockedText).not.toContain("+1-305-555-0148");
  expect(lockedText).not.toContain("Operational trust departure");
  await page.unroute("**/api/staff-activity");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toHaveCount(0);
  const retryPath = testInfo.outputPath("retry.pdf");
  await page.pdf({ path: retryPath, format: "Letter", printBackground: true });
  const retryText = pdfText(retryPath);
  expect(retryText).toContain("Ari Vale");
  expect(retryText).toContain("+1-305-555-0148");
  expect(retryText).not.toContain("Session paused");
});
