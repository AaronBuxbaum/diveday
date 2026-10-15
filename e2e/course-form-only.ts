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
  const forms = page.locator("form", {
    has: page.getByRole("button", { name: "Save forms" }),
  });
  for (const box of await forms.getByRole("checkbox").all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await forms.getByRole("button", { name: "Save forms" }).click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();
}
