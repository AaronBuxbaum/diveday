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
  await page.goto(`/shop/${privateShop.slug}/trips/${tripId}/log`);
  await expect(page.getByRole("columnheader", { name: "After dive 5" }).first()).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Ari Vale" }).getByText("Not back aboard"),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await capturePrintPdfs(page, "five-dive-log", testInfo.outputDir);
});
