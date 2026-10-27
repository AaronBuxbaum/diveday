import path from "node:path";
import type { Page } from "@playwright/test";

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
