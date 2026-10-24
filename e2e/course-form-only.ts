import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Take every form off a course, on its page, and wait for the save. The demo's
 * courses ask for the shop's worded agency forms
 * (src/db/seed-course-form-wording.ts), so a spec about one form it writes
 * clears the course first and then requires that one (`requireCourseForm`).
 */
export async function clearCourseForms(page: Page, courseSlug: string): Promise<void> {
  await page.goto(`/shop/blue-mantis/courses/${courseSlug}/edit`);
  // Forms is a closed row of the course page's one form (visual review
  // 2026-10-24, A11): opened here, and saved with the page's Save.
  const forms = page.locator("#forms");
  await forms.locator("> summary").click();
  await expect(forms.getByRole("checkbox")).not.toHaveCount(0);
  for (const box of await forms.getByRole("checkbox").all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Course page saved")).toBeVisible();
}
