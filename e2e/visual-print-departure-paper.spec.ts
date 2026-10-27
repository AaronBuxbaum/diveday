import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import {
  DeparturePaperIdentity,
  departurePaperRule,
} from "../src/app/shop/[shopSlug]/trips/[id]/_components/DeparturePaperIdentity";
import { PacketSummary } from "../src/app/shop/[shopSlug]/trips/[id]/print/_components/PacketDocument";
import { staffTranslator } from "../src/i18n/staff-messages";
import { decode } from "./crew-pdf-pixels";
import { expect, signedInAsOwner, test } from "./fixtures";
import { seededTripId } from "./helpers";
import { REEF_TRIP } from "./visual-harness";

const normalize = (text: string) => text.replace(/\s/gu, "");
const poppler = (binary: string, args: string[]) =>
  execFileSync(binary, args, { encoding: "utf8", timeout: 30_000 });

/** Verify context against actual PDF words AND raster ink on every content sheet. */
async function verifyPaper(
  page: Page,
  info: TestInfo,
  name: string,
  titles: string[],
  openingSummary?: string,
  minimumSheets = 2,
) {
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = info.outputPath(`${name}.pdf`);
  const directory = info.outputPath(`${name}-sheets`);
  await mkdir(directory, { recursive: true });
  await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true, printBackground: true });
  poppler("pdftoppm", ["-png", "-scale-to", "1500", pdf, path.join(directory, "page")]);
  const xml = poppler("pdftotext", ["-bbox", pdf, "-"]);
  const sheets = [...xml.matchAll(/<page width="([\d.]+)" height="[\d.]+">([\s\S]*?)<\/page>/g)];
  const images = (await readdir(directory))
    .filter((file) => /^page-\d+\.png$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  expect(images.length).toBe(sheets.length);
  const contexts = new Set<string>();
  let contentSheets = 0;
  for (const [index, sheet] of sheets.entries()) {
    const words = [
      ...sheet[2].matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g,
      ),
    ];
    const header = words.filter((word) => Number(word[2]) < 125);
    const headerText = normalize(header.map((word) => decode(word[5])).join(" "));
    const bodyText = normalize(words.map((word) => decode(word[5])).join(" "));
    if (index === 0 && openingSummary) expect(bodyText).toContain(normalize(openingSummary));
    const matches = titles.filter((title) => headerText.includes(normalize(title)));
    // A day/packet cover may precede the named departure pages. Every content sheet must identify exactly one boat.
    if (
      !openingSummary &&
      index === 0 &&
      matches.length === 0 &&
      !titles.some((title) => bodyText.includes(normalize(title)))
    )
      continue;
    expect(matches, `sheet ${index + 1} must name exactly one departure`).toHaveLength(1);
    expect(header.map((word) => decode(word[5])).join(" ")).toMatch(/\b20\d{2}\b/);
    contexts.add(matches[0]);
    contentSheets++;
    expect(bodyText).toContain("America/New_York");
    expect(bodyText).toContain(`${index + 1}/${sheets.length}`);
    const imagePath = path.join(directory, images[index]);
    const pixels = await sharp(await readFile(imagePath))
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = pixels.info.width / Number(sheet[1]);
    for (const word of header) {
      if (!/[\p{L}\p{N}]/u.test(decode(word[5]))) continue;
      const [left, top, right, bottom] = word
        .slice(1, 5)
        .map((value) => Math.floor(Number(value) * scale));
      let ink = 0;
      for (let y = Math.max(0, top); y <= Math.min(pixels.info.height - 1, bottom); y++) {
        for (let x = Math.max(0, left); x <= Math.min(pixels.info.width - 1, right); x++) {
          if (pixels.data[y * pixels.info.width + x] < 160) ink++;
        }
      }
      expect(
        ink,
        `sheet ${index + 1} header word ${decode(word[5])} must have visible ink`,
      ).toBeGreaterThan(1);
    }
    await info.attach(`${name}-sheet-${index + 1}`, { path: imagePath, contentType: "image/png" });
  }
  expect(contentSheets).toBeGreaterThanOrEqual(minimumSheets);
  expect([...contexts].sort()).toEqual([...titles].sort());
  await info.attach(name, { path: pdf, contentType: "application/pdf" });
}

signedInAsOwner();
test.use({ viewport: { width: 816, height: 1056 } });

test("standalone manifest and log repeat visible departure context including uppercase UUID routes", async ({
  page,
}, info) => {
  const id = await seededTripId(page, "blue-mantis", REEF_TRIP);
  for (const surface of ["manifest", "log"] as const) {
    await page.goto(`/shop/blue-mantis/trips/${id.toUpperCase()}/${surface}`);
    await expect(page.locator("[data-departure-paper]")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: REEF_TRIP })).toBeVisible();
    await verifyPaper(page, info, `standalone-${surface}`, [REEF_TRIP]);
  }
});

test("day packet continuation sheets retain exactly their own departure identity", async ({
  page,
}, info) => {
  await page.goto("/shop/blue-mantis/print");
  await expect(
    page.getByRole("heading", {
      name: staffTranslator("en-US")("shared.printPacket.dayTitle"),
      exact: true,
    }),
  ).toBeVisible();
  const packet = page.locator(".trip-print-bundle[data-paper-screen]").filter({ visible: true });
  await expect(packet).toBeVisible();
  await expect(packet.locator("[data-packet-ready]")).toBeAttached();
  const departureTitles = packet.locator("[data-trip-page-header] h1").filter({ visible: true });
  await expect(departureTitles.first()).toBeVisible();
  const titles = [...new Set(await departureTitles.allTextContents())];
  expect(titles.length).toBeGreaterThan(1);
  await verifyPaper(
    page,
    info,
    "multi-departure-day",
    titles,
    staffTranslator("en-US")("shared.printPacket.dayTitle"),
  );
});

test("maximum multiline titles and wide names retain visible headers without shared-data mutations", async ({
  page,
}, info) => {
  const multiline = `${"X\n".repeat(59)}X`;
  const normalized = Array(60).fill("X").join(" ");
  const second = "W".repeat(120);
  const documents = [multiline, second].map((title, index) => {
    const pageName = `departure-stress-${index}`;
    const css = departurePaperRule(
      pageName,
      [
        "Z".repeat(120),
        title,
        "27 October 2026 09:00 America/New_York",
        "V".repeat(80),
        "Manifest · Departure",
      ],
      "Printed 27 October 2026 08:30 America/New_York",
    );
    const rows = Array.from(
      { length: 100 },
      (_, row) => `<p>Departure ${index} roster record ${row} — diver and crew safety facts</p>`,
    ).join("");
    return `<style>${css}</style><section data-departure-paper="${pageName}">${rows}</section>`;
  });
  // Pure local document uses the production named-page generator; no staff or shop data changes.
  await page.setContent(
    `<html><head><style>@page{margin:0.5in}body{font:12pt sans-serif}p{margin:12pt 0}</style></head><body>${documents.join("")}</body></html>`,
  );
  await verifyPaper(page, info, "maximum-multiline-context", [normalized, second]);
});

test("changed-first and empty-day summaries do not create isolated cover sheets", async ({
  page,
}, info) => {
  const t = staffTranslator("en-US");
  const summary = t("shared.printPacket.dayTitle");
  for (const changed of [true, false]) {
    const heading = changed ? t("shared.printPacket.changedHeading") : summary;
    const pageName = changed ? "departure-isolated-changed" : undefined;
    const children = createElement(
      "p",
      null,
      changed
        ? t("shared.printPacket.changed", { id: "isolated-departure" })
        : t("shared.printPacket.dayEmpty"),
    );
    const warning = changed
      ? createElement(DeparturePaperIdentity, {
          pageName: pageName ?? "",
          identity: ["Isolated shop", heading, "27 October 2026 America/New_York"],
          printed: "Printed 27 October 2026 America/New_York",
          children,
        })
      : children;
    const summaryProps = {
      openingPageName: pageName,
      children: [
        createElement("h1", { key: "title" }, summary),
        createElement("p", { key: "printed" }, "27 October 2026 America/New_York"),
      ],
    };
    const html = renderToStaticMarkup(
      createElement("main", null, createElement(PacketSummary, summaryProps), warning),
    );
    // Local composition exercises production summary ownership without modifying shared shop data.
    await page.setContent(
      `<html><head><style>@page{margin:.5in;@bottom-right{content:counter(page) " / " counter(pages)}}body{font:12pt sans-serif}</style></head><body>${html}</body></html>`,
    );
    const name = changed ? "changed-first-summary" : "empty-day-summary";
    await verifyPaper(page, info, name, [heading], summary, 1);
    const pdf = await readFile(info.outputPath(`${name}.pdf`));
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  }
});

test("a paused session prints no departure information and retry restores the document", async ({
  page,
}, info) => {
  const id = await seededTripId(page, "blue-mantis", REEF_TRIP);
  await page.goto(`/shop/blue-mantis/trips/${id}/manifest`);
  await expect(page.getByRole("heading", { level: 1, name: REEF_TRIP })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.route("**/api/staff-activity", (route) => route.fulfill({ status: 401 }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toBeVisible();
  const locked = info.outputPath("paused-manifest.pdf");
  await page.pdf({ path: locked, format: "Letter", printBackground: true });
  const text = poppler("pdftotext", ["-layout", locked, "-"]);
  expect(text).toContain("Session paused");
  expect(text).not.toContain(REEF_TRIP);
  expect(text).not.toContain("Priya Sharma");
  expect(text).not.toContain("+1-305-555-0231");
  await page.unroute("**/api/staff-activity");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alertdialog", { name: "Session paused" })).toHaveCount(0);
  const restored = info.outputPath("restored-manifest.pdf");
  await page.pdf({ path: restored, format: "Letter", printBackground: true });
  const restoredText = poppler("pdftotext", ["-layout", restored, "-"]);
  expect(restoredText).toContain(REEF_TRIP);
  expect(restoredText).toContain("Priya Sharma");
  expect(restoredText).toContain("+1-305-555-0231");
});
