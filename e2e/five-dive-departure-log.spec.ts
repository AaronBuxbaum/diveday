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
  await expect(contact).toBeVisible();
  const fits = await contact.evaluate((span) => {
    const cell = span.closest("td");
    if (!cell) return false;
    return span.getBoundingClientRect().right <= cell.getBoundingClientRect().right;
  });
  expect(fits).toBe(true);
  await capturePrintPdfs(page, "five-dive-log", testInfo.outputDir);
  await page.route("**/api/staff-activity", (route) => route.fulfill({ status: 401 }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational trust departure" })).toBeHidden();
  await page.pdf({
    path: testInfo.outputPath("locked.pdf"),
    format: "Letter",
    printBackground: true,
  });
});
