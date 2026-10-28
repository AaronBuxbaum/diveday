import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures";

for (const document of [
  { route: "/s/blue-mantis", title: "Schedule" },
  { route: "/s/blue-mantis/courses/open-water-diver", title: "Open Water Diver" },
]) {
  test(`${document.title} repeats its paper identity on continuation sheets`, async ({
    page,
  }, testInfo) => {
    await page.goto(document.route);
    await expect(page.locator("main h1")).toBeVisible();
    await page.evaluate(() => window.document.fonts.ready);
    for (const format of ["Letter", "A4"] as const) {
      const pdf = testInfo.outputPath(`${format}.pdf`);
      await page.pdf({ path: pdf, format, preferCSSPageSize: true, printBackground: true });
      const text = execFileSync("pdftotext", ["-layout", pdf, "-"], {
        encoding: "utf8",
        timeout: 30_000,
      });
      const sheets = text.split("\f").filter((sheet) => sheet.trim());
      expect(sheets.length).toBeGreaterThan(1);
      for (const sheet of sheets) {
        const header = sheet.trimStart().split("\n").slice(0, 3).join(" ");
        expect(header).toContain("Blue Mantis Divers");
        expect(header).toContain(document.title);
      }
    }
  });
}
