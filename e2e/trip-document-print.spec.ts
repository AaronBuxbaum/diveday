import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { diverTranslator } from "../src/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "../src/i18n/readiness-labels";
import { expect, signedInAsOwner, test } from "./fixtures";
import { seededTripId } from "./helpers";

signedInAsOwner();

const t = diverTranslator("en-US");

test("trip details print saved facts independently of an open editor", async ({ page }, info) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(`/shop/blue-mantis/trips/${id}?view=details`);
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  const labels = await page.locator("[data-trip-detail-row] > :first-child").allTextContents();
  const row = page.locator("#departure-details");
  await row.locator("summary").click();
  await row.locator('input[name="title"]').fill("UNSAVED PAPER TITLE");
  await page.emulateMedia({ media: "print" });
  await expect(row.locator('input[name="title"]')).not.toBeVisible();
  await expect(page.locator("[data-trip-detail-row]").first()).toBeVisible();
  const pdf = info.outputPath("trip-details.pdf");
  await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true });
  const words = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8", timeout: 30_000 });
  const normalize = (value: string) => value.replace(/\s+/gu, "").toLowerCase();
  expect(normalize(words)).toContain(normalize(title));
  for (const label of labels) expect(normalize(words)).toContain(normalize(label));
  expect(words).toContain("Blue Mantis Divers");
  expect(words).toContain("America/New_York");
  expect(words).toMatch(/20\d{2}/);
  expect(words).not.toContain("UNSAVED PAPER TITLE");
  await info.attach("trip-details", { path: pdf, contentType: "application/pdf" });
});

test("paper keeps a full boat's status and an embedded course's age and contact facts", async ({
  page,
}) => {
  const full = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
  await page.goto(`/s/blue-mantis/trips/${full}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-public-trip-terms]")).toContainText(t("booking.fullHeading"));
  await page.emulateMedia({ media: "screen" });
  const course = await seededTripId(page, "blue-mantis", "Open Water Diver — three-day course");
  await page.goto(`/s/blue-mantis/trips/${course}?embed=1`);
  await page.emulateMedia({ media: "print" });
  const facts = page.locator("[data-public-trip-terms]");
  await expect(facts).toContainText(t("course.agesAndUp", { age: 10 }));
  await expect(facts).toContainText(t("course.noCertification"));
  await expect(facts).toContainText(t("trip.questionsContact"));
  await expect(facts.locator('a[href^="mailto:"]')).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  const continuing = await seededTripId(
    page,
    "blue-mantis",
    "Nitrox Diver — classroom & two dives",
  );
  await page.goto(`/s/blue-mantis/trips/${continuing}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-public-trip-terms]")).toContainText(
    t("course.certificationOrHigher", { level: t(DIVER_CERTIFICATION_LEVEL_KEYS.open_water) }),
  );
});

test("public trip prints its briefing and terms without a booking worksheet", async ({
  page,
}, info) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(`/s/blue-mantis/trips/${id}`);
  await expect(page.locator("#book")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#book")).not.toBeVisible();
  await expect(page.locator("[data-public-trip-terms]")).toBeVisible();
  const briefing = page.locator("[data-public-trip-reading] details").first();
  await expect(briefing).not.toHaveAttribute("open", "");
  const species = await briefing.locator("li p").first().innerText();
  await expect(briefing.locator(":scope > :not(summary)")).toBeVisible();
  const map = briefing.locator('[class~="group/map"]');
  await expect(map).not.toBeVisible();
  await expect(briefing.locator("figcaption").first()).toBeVisible();
  const pdf = info.outputPath("public-trip.pdf");
  await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true });
  const words = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8", timeout: 30_000 });
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  // PDF text extraction may interleave the field guide's two columns.
  expect(normalize(words)).toContain(normalize(species));
  const sheets = words.split("\f").filter((sheet) => sheet.trim());
  for (const [index, sheet] of sheets.entries()) {
    expect(sheet).toContain("Blue Mantis Divers");
    expect(sheet).toContain("America/New_York");
    const prefix = info.outputPath(`trip-sheet-${index + 1}`);
    // Render independently: some Poppler versions drop margin ink when rendering multiple sheets in one invocation.
    execFileSync(
      "pdftoppm",
      [
        "-f",
        String(index + 1),
        "-l",
        String(index + 1),
        "-singlefile",
        "-scale-to",
        "1400",
        "-png",
        pdf,
        prefix,
      ],
      { timeout: 30_000 },
    );
    const pixels = await sharp(`${prefix}.png`)
      .extract({ left: 30, top: 20, width: 800, height: 80 })
      .greyscale()
      .raw()
      .toBuffer();
    expect(
      pixels.filter((value) => value < 160).length,
      `sheet ${index + 1} has visible header ink`,
    ).toBeGreaterThan(100);
    await info.attach(`trip-sheet-${index + 1}`, {
      path: `${prefix}.png`,
      contentType: "image/png",
    });
  }
  await info.attach("public-trip", { path: pdf, contentType: "application/pdf" });
});
