import type { Locator } from "@playwright/test";
import { expect } from "./fixtures";

/** Expanded requirement editors use their task's width, including at phone size. */
export async function expectFolioRemedyGeometry(form: Locator) {
  await expect(form).toBeVisible();
  const geometry = await form.evaluate((element) => {
    const task = element.closest("section");
    if (!task) throw new Error("The remedy has no requirement section");
    const bounds = element.getBoundingClientRect();
    const taskBounds = task.getBoundingClientRect();
    return {
      formWidth: bounds.width,
      taskWidth: taskBounds.width,
      right: bounds.right,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      fields: [
        ...element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          "input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea",
        ),
      ]
        .filter((field) => field.getClientRects().length)
        .map((field) => {
          const fieldBounds = field.getBoundingClientRect();
          return { width: fieldBounds.width, right: fieldBounds.right };
        }),
    };
  });
  expect(geometry.formWidth).toBeGreaterThanOrEqual(geometry.taskWidth - 2);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const field of geometry.fields) {
    expect(field.width).toBeGreaterThan(geometry.formWidth / 3);
    expect(field.right).toBeLessThanOrEqual(geometry.right);
  }
}
