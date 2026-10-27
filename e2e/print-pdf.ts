import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Save real pagination before a screenshot helper applies its long-sheet rule. */
export async function capturePrintPdfs(page: Page, name: string, directory = "e2e/screenshots") {
  const files: string[] = [];
  for (const format of ["Letter", "A4"] as const) {
    // Keep the existing Letter filename; small sheets retain their explicit CSS size.
    const file = path.join(directory, `${name}-print${format === "A4" ? "-a4" : ""}.pdf`);
    await page.pdf({ path: file, format, preferCSSPageSize: true, printBackground: true });
    files.push(file);
  }
  return files;
}

/** Stress pagination on real rendered markup without mutating React's live hydration tree. */
export async function staticPrintPage(source: Page): Promise<Page> {
  await expect(
    source.locator("main .animate-pulse:not([data-live-pulse])").filter({ visible: true }),
  ).toHaveCount(0);
  await source.evaluate(() => document.fonts.ready);
  const html = await source.evaluate(() => {
    const documentCopy = document.documentElement.cloneNode(true) as HTMLElement;
    for (const script of documentCopy.querySelectorAll("script")) script.remove();
    const base = document.createElement("base");
    base.href = document.baseURI;
    documentCopy.querySelector("head")?.prepend(base);
    return `<!doctype html>${documentCopy.outerHTML}`;
  });
  const paper = await source.context().newPage();
  await paper.emulateMedia({ media: "print" });
  await paper.setContent(html);
  await paper.evaluate(() => document.fonts.ready);
  return paper;
}
