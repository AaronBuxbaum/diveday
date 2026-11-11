import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect } from "./fixtures";
import { bookASeatAndOpenThread } from "./helpers";

const t = diverTranslator("en-US");

export async function openMultiDayCourseBooking(page: Page) {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  await page.getByRole("link", { name: "Book this date" }).first().click();
  await expect(page.getByRole("heading", { name: t("booking.courseHeading") })).toBeVisible();
  // The same course plan also exists in the hidden print-only paper sheet.
  const plan = page.getByTestId("trip-course-plan").filter({ visible: true });
  await expect(plan).toHaveCount(1);
  await expect(plan).toContainText("Day 3");
}

export async function enrollInMultiDayCourse(page: Page) {
  await openMultiDayCourseBooking(page);
  await bookASeatAndOpenThread(page, "Jordan Course", "jordan-course@example.com");
  const meetings = page.getByTestId("ready-meeting-days").filter({ visible: true });
  await expect(meetings).toHaveCount(1);
  await expect(meetings.locator("li")).toHaveCount(3);
  await expect(page.getByTestId("ready-session-day")).toContainText("Day 3");
  await expect(page.getByText(/Your course starts at/)).toBeVisible();
  await expect(page.getByRole("link", { name: t("ready.materialsAccess") })).toBeVisible();
}
