import jsQR from "jsqr";
import sharp from "sharp";
import { openCourseFormQr } from "./course-forms-qr-helper";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";

// The QR is a bearer capability; never attach an image or trace of it.
test.use({ screenshot: "off", trace: "off" });
signedInAsOwner();

test("a student scans and signs on their phone after the counter closes the code", async ({
  page,
  browser,
  workerBaseURL,
}) => {
  test.setTimeout(60_000);
  const { student, title, row, dialog, t } = await openCourseFormQr(page, { clock: true });
  await expect(row.getByText(/waiver not signed/i)).toBeVisible();
  const src = await dialog.getByRole("img").getAttribute("src");
  if (!src?.startsWith("data:image/png;base64,")) throw new Error("QR image missing");
  const png = Buffer.from(src.slice("data:image/png;base64,".length), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!decoded) throw new Error("QR image could not be decoded");
  const url = new URL(decoded.data);
  if (!url.pathname.endsWith("/forms")) throw new Error("QR did not open course forms");
  const phoneContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const phone = makeActivitySafe(await phoneContext.newPage());
    await phone.goto(url.pathname);
    await expect(phone.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // Staff can close the handoff before the student finishes reading.
    await dialog.getByRole("button", { name: t("trips.roster.courseForms.qrClose") }).click();
    await phone.getByLabel("Type your full name").fill(student);
    await phone.getByRole("checkbox", { name: /I have read this form/ }).check();
    await phone.getByRole("button", { name: "Sign form" }).click();
    await expect(phone.getByText("Course forms signed")).toBeVisible();
    await page.clock.fastForward(61_000);
    await expect(row.locator("[data-course-forms-owed]")).toHaveCount(0);
    await expect(row.getByText(/waiver not signed/i)).toBeVisible();
    // The forms-only capability does not expose the student's Ready page.
    await phone.goto(url.pathname.slice(0, -"/forms".length));
    await expect(phone.getByRole("heading", { level: 1, name: title })).toHaveCount(0);
    await expect(phone.getByText(student, { exact: true })).toHaveCount(0);
  } finally {
    await phoneContext.close();
  }
});
