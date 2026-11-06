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
  // The departure's sheet is the page on paper, framed or not (#2745).
  const sheet = page.locator(".paper-sheet");
  await expect(sheet).not.toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toContainText(t("booking.fullHeading"));
  await page.emulateMedia({ media: "screen" });
  const course = await seededTripId(page, "blue-mantis", "Open Water Diver — three-day course");
  await page.goto(`/s/blue-mantis/embed/trip/${course}`);
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toContainText(t("course.agesAndUp", { age: 10 }));
  await expect(sheet).toContainText(t("course.noCertification"));
  await expect(sheet).toContainText(t("trip.questionsContact"));
  // The shop's address is words on paper: nothing on a sheet taps.
  await expect(sheet).toContainText("@");
  await expect(sheet.locator("a, button, input, select, textarea")).toHaveCount(0);
  await page.emulateMedia({ media: "screen" });
  const continuing = await seededTripId(
    page,
    "blue-mantis",
    "Nitrox Diver — classroom & two dives",
  );
  await page.goto(`/s/blue-mantis/trips/${continuing}`);
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toContainText(
    t("course.certificationOrHigher", { level: t(DIVER_CERTIFICATION_LEVEL_KEYS.open_water) }),
  );
});

test("public trip prints its departure sheet and never the booking form", async ({
  page,
}, info) => {
  const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(`/s/blue-mantis/trips/${id}`);
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  await expect(page.locator("#book")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#book")).not.toBeVisible();
  const sheet = page.locator(".paper-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(sheet).toContainText(t("trip.theDay"));
  await expect(sheet).toContainText(t("trip.lookFor"));
  const pdf = info.outputPath("public-trip.pdf");
  await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true });
  const words = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8", timeout: 30_000 });
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  expect(normalize(words)).toContain(normalize(title));
  // The fold names the departure's own address; a wrapped line can drop a hyphen.
  expect(words.replace(/[\s-]/gu, "")).toContain(`/s/blue-mantis/trips/${id}`.replace(/-/gu, ""));
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
