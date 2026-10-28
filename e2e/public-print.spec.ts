import { diverTranslator } from "../src/i18n/messages";
import { SUPPORT_EMAIL } from "../src/lib/platform-mail";
import { expect, test } from "./fixtures";
import { bookOpenWaterSession, openThreadStep } from "./helpers";
import { capturePrintPdfs } from "./print-pdf";

test("marketing paper keeps its identity without the open navigation menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toBeEnabled();
  await menu.click();
  const product = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Product", exact: true });
  await expect(product).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(menu).not.toBeVisible();
  await expect(product).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await capturePrintPdfs(page, "public-pricing-navigation");
});

test("the homepage print hero fits before the first paper break", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const setup = page.getByRole("link", { name: "Get set up", exact: true }).first();
  await expect(setup).toBeVisible();
  const bookingDoor = page.getByRole("link", { name: "Find your booking", exact: true });
  await expect(bookingDoor).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(setup).not.toBeVisible();
  await expect(bookingDoor).not.toBeVisible();
  await expect(
    page.locator("footer").getByRole("link", { name: "Pricing", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.locator("footer").getByRole("link", { name: SUPPORT_EMAIL, exact: true }),
  ).toBeVisible();
  const hero = page.locator("main > section").first();
  // A screen phone drawing previously made the hero too tall to follow the
  // header, leaving the first real PDF sheet almost entirely blank.
  expect(await hero.evaluate((section) => section.getBoundingClientRect().height)).toBeLessThan(
    700,
  );
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  // The original nine-sheet brochure included a blank first sheet and a
  // footer-only last sheet. Its five steps now share four useful sheets.
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeLessThanOrEqual(4);
  await capturePrintPdfs(page, "public-home-hero");
});

test("the public schedule prints dates without duplicate jump and paging controls", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  const jump = page.locator('a[href^="#day-"]').first();
  await expect(jump).toBeVisible();
  const monthNext = page.getByRole("link", { name: /next month/i });
  await expect(monthNext).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("main img").filter({ visible: true })).toHaveCount(0);
  const contexts = page.locator("[data-print-departure-context]");
  await expect(contexts.first()).toBeVisible();
  for (const context of await contexts.all()) {
    await expect(context).toHaveText(/\S.*(?:EDT|EST)/);
  }
  await expect(page.getByRole("heading", { name: "Our year", exact: true })).toBeHidden();
  await expect(page.locator("#more-ways-heading")).toBeHidden();
  await expect(page.locator("footer")).toContainText("100 Ocean Drive");
  await expect(jump).not.toBeVisible();
  await expect(monthNext).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await capturePrintPdfs(page, "public-schedule-controls");
});

for (const route of ["/get-set-up", "/s/blue-mantis/reviews"]) {
  test(`${route} keeps its content and footer on one paper sheet`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    await capturePrintPdfs(page, route === "/get-set-up" ? "public-setup" : "public-reviews");
  });
}

test("the check-in feature prints a useful first sheet", async ({ page }) => {
  await page.goto("/product/check-in");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const hero = page.locator("main > section").first();
  expect(
    await hero.locator(":scope > div").evaluate((element) => getComputedStyle(element).display),
  ).toBe("block");
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeLessThanOrEqual(3);
  await capturePrintPdfs(page, "public-feature-check-in");
});

test("a course prep PDF keeps the checklist without signing actions", async ({ page }) => {
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
  await expect(
    sign.getByText(diverTranslator("en-US")("ready.courseFormsNeedSigning"), { exact: true }),
  ).toBeVisible();
  await expect(
    sign.getByText(diverTranslator("en-US")("ready.checklistDetail.waiverPending"), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(sign.getByText("Sign", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where to go", exact: true })).toBeVisible();
  const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await capturePrintPdfs(page, "public-course-prep-actions");
});
