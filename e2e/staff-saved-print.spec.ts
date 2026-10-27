import { execFileSync } from "node:child_process";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();
test.use({ viewport: { width: 816, height: 1056 } });

test("saved course details print without unsubmitted prerequisite edits", async ({
  page,
}, testInfo) => {
  await page.goto("/shop/blue-mantis/courses/discover-scuba-diving/edit");
  await page.locator("#enroll > summary").click();
  const prerequisite = page.locator('textarea[name="prerequisiteNote"]');
  const original = await prerequisite.inputValue();
  await prerequisite.fill("UNSUBMITTED PAPER DRAFT");
  const saved = page.locator("[data-saved-print-details]");
  await expect(saved).not.toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(saved).toBeVisible();
  await expect(saved).not.toContainText("UNSUBMITTED PAPER DRAFT");
  if (original) await expect(saved).toContainText(original);
  const file = testInfo.outputPath("saved-course.pdf");
  await page.pdf({ path: file, format: "Letter", preferCSSPageSize: true });
  const text = execFileSync("pdftotext", ["-layout", file, "-"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(text).toContain("Saved details");
  expect(text).toContain("UNSUBMITTED PAPER DRAFT");
  expect(text).toContain("Editor values, including unsaved changes");
});

test("saved site notes print independently of an unsaved route edit", async ({
  page,
}, testInfo) => {
  await page.goto("/shop/blue-mantis/dive-sites");
  await page.getByRole("link", { name: "Christ of the Abyss", exact: true }).click();
  await page.locator("#briefing-route > summary").click();
  const route = page.locator('input[name="routeNote"]');
  const original = await route.inputValue();
  await route.fill("UNSUBMITTED ROUTE DRAFT");
  const saved = page.locator("[data-saved-print-details]");
  await expect(saved).not.toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(saved).toBeVisible();
  await expect(saved).not.toContainText("UNSUBMITTED ROUTE DRAFT");
  if (original) await expect(saved).toContainText(original);
  const file = testInfo.outputPath("saved-site.pdf");
  await page.pdf({ path: file, format: "Letter", preferCSSPageSize: true });
  const text = execFileSync("pdftotext", ["-layout", file, "-"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(text).toContain("Saved details");
  expect(text).toContain("UNSUBMITTED ROUTE DRAFT");
  expect(text).toContain("Editor values, including unsaved changes");
});

test("paper hides closed service and release doors while keeping an opened service form", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/gear");
  await page.getByRole("link", { name: "BCD #1", exact: true }).click();
  const service = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "Log a service" }) });
  const note = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "Add a note" }) });
  await expect(service).toBeVisible();
  await expect(note).toBeVisible();
  await service.locator("summary").click();
  await page.emulateMedia({ media: "print" });
  await expect(service).toBeVisible();
  await expect(note).not.toBeVisible();
  await expect(page.getByText("CS-2201", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.goto("/shop/blue-mantis/waivers");
  const release = page.locator("#release");
  await expect(release).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signed records", exact: true })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(release).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Signed records", exact: true })).toBeVisible();
});
