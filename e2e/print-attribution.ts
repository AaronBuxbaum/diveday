import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

/** Real PDF coordinates: a long-sheet screenshot cannot expose flex fragmentation. */
export function assertPacketAttributionBelowKit(pdf: string) {
  assertAttributionBelowWord(pdf, "pressure");
}

/** The release acknowledgement is the final line in the seeded signed waiver. */
export function assertWaiverAttributionBelowAcknowledgement(pdf: string) {
  assertAttributionBelowWord(pdf, "freely.");
}

function assertAttributionBelowWord(pdf: string, finalWord: string) {
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const pages = [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
  let lastBodyPage = -1;
  let lastAttributionPage = -1;
  for (const [index, page] of pages.entries()) {
    const words = [
      ...page[1].matchAll(
        /<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]+)<\/word>/g,
      ),
    ];
    const finalWords = words.filter((word) => word[3] === finalWord);
    const printed = words.filter((word) => word[3] === "Printed");
    if (finalWords.length) lastBodyPage = index;
    if (printed.length) lastAttributionPage = index;
    // A footer may move to the following page, but may never run over body text.
    for (const label of finalWords) {
      for (const footer of printed) expect(Number(footer[1])).toBeGreaterThan(Number(label[2]));
    }
  }
  expect(lastBodyPage, `fixture includes ${finalWord}`).toBeGreaterThanOrEqual(0);
  expect(lastAttributionPage, "dated footer follows the final body line").toBeGreaterThanOrEqual(
    lastBodyPage,
  );
}
