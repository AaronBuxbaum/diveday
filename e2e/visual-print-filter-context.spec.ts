import { execFileSync } from "node:child_process";
import { expect, signedInAsOwner, test } from "./fixtures";
import { staticPrintPage } from "./print-pdf";
import { capturePrint, installVisualBuildGuard } from "./visual-harness";

const pdfText = (file: string) =>
  execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", timeout: 30_000 });
const normalizePdf = (text: string) => text.replace(/\s/gu, "");

installVisualBuildGuard();
signedInAsOwner();
test.use({ viewport: { width: 816, height: 1056 } });

test("printed filtered gear keeps the selected scope without navigation pills", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/gear?kind=bcd");
  await expect(page.getByRole("heading", { name: "Gear", exact: true })).toBeVisible();
  const selected = page.locator('main nav a[aria-current="true"]').first();
  await expect(selected).toBeVisible();
  const context = await selected.innerText();
  const navigation = page
    .locator("main nav")
    .filter({ has: page.locator('a[aria-current="true"]') })
    .first();
  await expect(navigation).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(navigation).not.toBeVisible();
  await expect(page.getByText(context, { exact: true })).toBeVisible();
  await expect(page.getByText("BCD #1", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await capturePrint(page, "gear-filter-context");
});

test("printed diver roster keeps its order without add and download actions", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const add = page.getByRole("link", { name: "Add diver", exact: true });
  const download = page.getByRole("link", { name: "Download this list (CSV)", exact: true });
  const more = page.locator("main").getByRole("button", { name: "More", exact: true });
  await expect(add).toBeVisible();
  await more.click();
  await expect(download).toBeVisible();
  const sort = page.locator('main nav [aria-current="true"]').filter({ hasText: "Name" });
  await expect(sort).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(add).not.toBeVisible();
  await expect(more).not.toBeVisible();
  await expect(download).not.toBeVisible();
  await expect(sort).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await capturePrint(page, "divers-paper-roster");
});

test("printed roster states its visible subset rather than a web page number", async ({
  page,
}, testInfo) => {
  await page.goto("/shop/blue-mantis/divers");
  await expect(page.getByRole("heading", { name: "Divers", exact: true })).toBeVisible();
  const pager = page.getByRole("navigation", { name: "Pages", exact: true });
  await expect(pager).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(pager).not.toBeVisible();
  const subset = page.locator("[data-paper-roster-count]");
  await expect(subset).toHaveText("20 of 142 divers shown");
  const file = testInfo.outputPath("divers-visible-subset.pdf");
  await page.pdf({ path: file, format: "Letter", preferCSSPageSize: true });
  const text = pdfText(file);
  expect(text).toContain("20 of 142 divers shown");
  expect(text).not.toContain("Page 1 of 8");
});

test("schedule PDFs keep ordinary days whole and oversized days dated", async ({
  page,
}, testInfo) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await expect(page.locator("[data-week-board]").filter({ visible: true })).toBeVisible();
  const days = page.locator("[data-week-day]").filter({ visible: true });
  await expect(days).not.toHaveCount(0);
  const normal = await days.evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        titles: [...node.querySelectorAll("a[data-departure-door]")].map(
          (link) => link.getAttribute("aria-label") ?? "",
        ),
        date: node.querySelector("[data-week-paper-date]")?.textContent ?? "",
      }))
      .filter((day) => day.titles.length > 0),
  );
  await page.emulateMedia({ media: "print" });
  for (const format of ["Letter", "A4"] as const) {
    const file = testInfo.outputPath(`schedule-${format}.pdf`);
    await page.pdf({ path: file, format, preferCSSPageSize: true });
    const sheets = pdfText(file).split("\f");
    for (const day of normal) {
      expect(
        sheets.some(
          (sheet) =>
            day.titles.every((title) => normalizePdf(sheet).includes(normalizePdf(title))) &&
            normalizePdf(sheet).includes(normalizePdf(day.date)),
        ),
      ).toBe(true);
    }
  }
  await page.emulateMedia({ media: "screen" });
  // Repeat an existing day's own rows only in this browser fixture, so it exceeds a sheet.
  const paper = await staticPrintPage(page);
  const large = await paper.locator("[data-week-day]").evaluateAll((nodes) => {
    const day = nodes.reduce((largest, node) =>
      node.querySelectorAll("li").length > largest.querySelectorAll("li").length ? node : largest,
    );
    const list = day.querySelector("ul");
    const row = list?.querySelector("li");
    if (!list || !row) throw new Error("Schedule has no departure rows");
    const title = row.querySelector("a[data-departure-door]")?.getAttribute("aria-label") ?? "";
    const date = row.querySelector("[data-week-paper-date]")?.textContent ?? "";
    for (let index = 0; index < 35; index++) list.append(row.cloneNode(true));
    return { title, date };
  });
  const file = testInfo.outputPath("schedule-oversized-day.pdf");
  await paper.pdf({ path: file, format: "Letter", preferCSSPageSize: true });
  const continuations = pdfText(file)
    .split("\f")
    .filter((sheet) => normalizePdf(sheet).includes(normalizePdf(large.title)));
  expect(continuations.length).toBeGreaterThan(1);
  for (const sheet of continuations)
    expect(normalizePdf(sheet)).toContain(normalizePdf(large.date));
  await paper.close();
  // The screenshot helper installs a long-sheet @page rule; run it after real pagination.
  await capturePrint(page, "schedule-paper-days");
});
