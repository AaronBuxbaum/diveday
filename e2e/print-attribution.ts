import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

/** Real PDF coordinates: a long-sheet screenshot cannot expose flex fragmentation. */
export function assertPacketAttributionBelowKit(pdf: string) {
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const pages = [...xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
  let sawKit = false;
  let sawAttribution = false;
  for (const page of pages) {
    const words = [
      ...page[1].matchAll(
        /<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]+)<\/word>/g,
      ),
    ];
    const kit = words.filter((word) => word[3] === "pressure");
    const printed = words.filter((word) => word[3] === "Printed");
    sawKit ||= kit.length > 0;
    sawAttribution ||= printed.length > 0;
    // The English seeded packet's final body label is “O2 pressure”. Its
    // footer may move to the following page, but may never run over the kit.
    for (const label of kit) {
      for (const footer of printed) expect(Number(footer[1])).toBeGreaterThan(Number(label[2]));
    }
  }
  expect(sawKit, "fixture includes the final oxygen-kit lines").toBe(true);
  expect(sawAttribution, "packet retains its dated footer").toBe(true);
}
