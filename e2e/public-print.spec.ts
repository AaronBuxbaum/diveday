import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { bookOpenWaterSession, openThreadStep } from "./helpers";
import { capturePrintPdfs } from "./print-pdf";

test("the public schedule prints its sheet and none of its controls", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const jump = page.locator('a[href^="#day-"]').first();
  await expect(jump).toBeVisible();
  const monthNext = page.getByRole("link", { name: /next month/i });
  await expect(monthNext).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("img").filter({ visible: true })).toHaveCount(0);
  const sheet = page.locator(".paper-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Schedule");
  // Each departure names its own zone: the list can cross a clock change.
  for (const row of await sheet.locator("li").all()) {
    await expect(row).toHaveText(/E[DS]T/);
  }
  await expect(page.getByRole("heading", { name: "Our year", exact: true })).toBeHidden();
  await expect(page.locator("#more-ways-heading")).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
  await expect(sheet).toContainText("100 Ocean Drive");
  await expect(jump).not.toBeVisible();
  await expect(monthNext).not.toBeVisible();
  await capturePrintPdfs(page, "public-schedule-sheet");
});

test("a course diver's day prints its sheet without signing actions or readiness", async ({
  page,
}) => {
  const t = diverTranslator("en-US");
  await bookOpenWaterSession(page, "Paper Course Diver", "paper-course@example.com");
  const sign = await openThreadStep(page, "sign");
  const forms = sign.getByRole("link", { name: "Sign course forms", exact: true });
  await expect(forms).toBeVisible();
  await expect(sign.getByRole("button", { name: "Sign your waiver", exact: true })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(forms).not.toBeVisible();
  await expect(
    sign.getByRole("button", { name: "Sign your waiver", exact: true }),
  ).not.toBeVisible();
  // The paper is the arrival card's, not the thread's: it leaves the house,
  // so it says where and when and never what is owed (#2745).
  // The trip page it booked on can stay mounted, hidden (cacheComponents).
  const sheet = page.locator(".paper-sheet", { hasText: t("trip.arrivalHeading") });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(t("trip.arrivalHeading"));
  await expect(sheet).toContainText(t("trip.packTitle"));
  await expect(sheet).not.toContainText(t("ready.checklistDetail.waiverPending"));
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await capturePrintPdfs(page, "public-course-prep-actions");
});
