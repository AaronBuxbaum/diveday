import jsQR from "jsqr";
import sharp from "sharp";
import { clearCourseForms } from "./course-form-only";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  createTrip,
  daysFromNow,
  e2eNow,
  openBookingActions,
  openTripAbout,
  requireCourseForm,
  rosterRow,
  seededTripId,
  tripPathByTitle,
  walkInFormPath,
  writeCourseForm,
} from "./helpers";

// The image itself is a bearer credential; do not retain screenshots or traces.
test.use({ screenshot: "off", trace: "off" });
signedInAsOwner();

test("a minor scans their own waiver on a signed-out phone and a guardian signs", async ({
  page,
  browser,
  workerBaseURL,
}) => {
  test.setTimeout(60_000);
  const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
  await page.goto(walkInFormPath("blue-mantis", tripId));
  await page.getByRole("button", { name: "Add another person" }).click();
  const child = page.getByRole("group", { name: "Person 2" });
  await child.getByLabel("Full name").fill("Sky Lagoon");
  await child.getByLabel(/Under 18/).check();
  await page.getByRole("button", { name: "Add another person" }).click();
  await page.getByRole("group", { name: "Person 3" }).getByLabel("Full name").fill("Chris Lagoon");
  await page.getByLabel("Full name").first().fill("Alex Lagoon");
  await expect(page.getByLabel("Full name").first()).toHaveValue("Alex Lagoon");
  await page.getByRole("button", { name: "Add to boat" }).click();
  await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers$/);
  await expect(page.getByText("A parent or guardian must also sign.")).toBeVisible();
  await page.getByRole("button", { name: "Show waiver QR code for Sky Lagoon" }).click();
  const dialog = page.getByRole("dialog", { name: "Party waivers" });
  const src = await dialog.getByRole("img").getAttribute("src");
  if (!src?.startsWith("data:image/png;base64,")) throw new Error("QR image missing");
  const png = Buffer.from(src.slice("data:image/png;base64,".length), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!decoded) throw new Error("QR could not be decoded");
  const url = new URL(decoded.data);
  if (!url.pathname.startsWith("/waivers/")) throw new Error("unexpected QR destination");
  const phoneContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const phone = makeActivitySafe(await phoneContext.newPage());
    await phone.goto(url.pathname).catch(() => {
      throw new Error("minor waiver navigation failed");
    });
    await expect(phone.getByRole("heading", { name: "Parent or guardian" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await phone.getByLabel("Type your full name").fill("Sky Lagoon");
    await phone.getByLabel("I have read this waiver, understand it, and agree to it.").check();
    const no = phone.getByRole("radio", { name: "No" });
    await expect(no).not.toHaveCount(0);
    for (const radio of await no.all()) await radio.check();
    await phone.getByLabel("Guardian’s full name").fill("Morgan Lagoon");
    await phone.getByLabel("Relationship to Sky Lagoon").selectOption("parent");
    await phone.getByLabel("I am this diver’s parent or legal guardian", { exact: false }).check();
    await phone.getByRole("button", { name: "Sign waiver" }).click();
    await expect(phone.getByRole("heading", { name: "Waiver signed" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Show waiver QR code for Alex Lagoon" }).click();
    const leadDialog = page.getByRole("dialog", { name: "Party waivers" });
    const leadSrc = await leadDialog.getByRole("img").getAttribute("src");
    if (!leadSrc?.startsWith("data:image/png;base64,")) throw new Error("lead QR image missing");
    const leadPng = Buffer.from(leadSrc.slice("data:image/png;base64,".length), "base64");
    const leadPixels = await sharp(leadPng)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const leadDecoded = jsQR(
      new Uint8ClampedArray(leadPixels.data),
      leadPixels.info.width,
      leadPixels.info.height,
    );
    if (!leadDecoded) throw new Error("lead QR could not be decoded");
    const leadPath = new URL(leadDecoded.data).pathname;
    await phone.goto(leadPath).catch(() => {
      throw new Error("lead waiver navigation failed");
    });
    await leadDialog.getByRole("button", { name: "Close" }).click();
    await phone.getByLabel("Type your full name").fill("Alex Lagoon");
    await phone.getByLabel("I have read this waiver, understand it, and agree to it.").check();
    const leadNo = phone.getByRole("radio", { name: "No" });
    await expect(leadNo).not.toHaveCount(0);
    for (const radio of await leadNo.all()) await radio.check();
    await phone.getByRole("button", { name: "Sign waiver" }).click();
    await expect(phone.getByRole("heading", { name: "Waiver signed" })).toBeVisible();
    expect(new URL(phone.url()).pathname.startsWith("/waivers/counter_")).toBe(true);
    await expect(phone.locator('a[href^="/ready/"]')).toHaveCount(0);
    await phone.reload().catch(() => {
      throw new Error("lead waiver reload failed");
    });
    await expect(phone.locator('a[href^="/ready/"]')).toHaveCount(0);
    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: "Sky Lagoon" });
    await expect(row.getByText("Waiver signed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show waiver QR code for Chris Lagoon" }).click();
    const thirdDialog = page.getByRole("dialog", { name: "Party waivers" });
    const thirdSrc = await thirdDialog.getByRole("img").getAttribute("src");
    if (!thirdSrc?.startsWith("data:image/png;base64,")) throw new Error("third QR image missing");
    const thirdPng = Buffer.from(thirdSrc.slice("data:image/png;base64,".length), "base64");
    const thirdPixels = await sharp(thirdPng)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const thirdDecoded = jsQR(
      new Uint8ClampedArray(thirdPixels.data),
      thirdPixels.info.width,
      thirdPixels.info.height,
    );
    if (!thirdDecoded) throw new Error("third QR could not be decoded");
    const thirdPath = new URL(thirdDecoded.data).pathname;
    await phone.goto(thirdPath).catch(() => {
      throw new Error("third waiver navigation failed");
    });
    await expect(phone.getByLabel("Type your full name")).toBeVisible();
    await thirdDialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("link", { name: "Back to departure" }).click();
    await expect(page).toHaveURL(counterPath("blue-mantis", tripId));
    const thirdRow = rosterRow(page, "Chris Lagoon");
    await openBookingActions(thirdRow);
    await thirdRow.getByRole("button", { name: "Remove booking" }).click();
    await thirdRow.getByRole("button", { name: "Yes, remove booking" }).click();
    await expect(page.getByRole("status")).toContainText("Booking canceled");
    await phone.reload().catch(() => {
      throw new Error("cancelled waiver reload failed");
    });
    await expect(phone.getByRole("heading", { name: "Sign your waiver" })).toBeVisible();
    await expect(phone.getByText("Two-Tank Reef — Molasses & French")).toHaveCount(0);
    await phone.getByLabel("Type your full name").fill("Chris Lagoon");
    await phone.getByLabel("I have read this waiver, understand it, and agree to it.").check();
    const thirdNo = phone.getByRole("radio", { name: "No" });
    await expect(thirdNo).not.toHaveCount(0);
    for (const radio of await thirdNo.all()) await radio.check();
    await phone.getByRole("button", { name: "Sign waiver" }).click();
    await expect(phone.getByRole("heading", { name: "Waiver signed" })).toBeVisible();
    await expect(phone.locator('a[href^="/ready/"]')).toHaveCount(0);
    await expect(phone.getByRole("heading", { name: "Your scheduled dive sites" })).toHaveCount(0);
    await expect(page.locator("#roster").getByText("Chris Lagoon")).toHaveCount(0);
  } finally {
    await phoneContext.close();
  }
});

test("a counter waiver receipt stays scoped when course forms are still outstanding", async ({
  page,
  browser,
  workerBaseURL,
}) => {
  test.setTimeout(90_000);
  const title = "Course statement for counter waiver";
  await writeCourseForm(
    page,
    title,
    "I will follow the instructor's plan for every in-water session.",
  );
  await clearCourseForms(page, "open-water-diver");
  await requireCourseForm(page, "open-water-diver", title);
  const courseTitle = `Counter course ${e2eNow().getTime()}`;
  // An earlier schedule draft can be restored by the desk. Clear it before
  // the fixture fills the new session, so it cannot overwrite its fields.
  await page.goto("/shop/blue-mantis/schedule/board?add=full");
  await page.locator('select[name="courseId"]').selectOption({ label: "Open Water Diver" });
  const startOver = page.getByRole("button", { name: "Start over" });
  if (await startOver.isVisible()) {
    await startOver.click();
    await expect(startOver).toHaveCount(0);
  }
  await createTrip(page, {
    course: "Open Water Diver",
    title: courseTitle,
    date: daysFromNow(1),
    departsAt: "18:00",
    returnsAt: "20:00",
  });
  const tripPath = await tripPathByTitle(page, "blue-mantis", new RegExp(`^${courseTitle}$`));
  await page.goto(tripPath);
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
  const tripId = new URL(tripPath, workerBaseURL).pathname.split("/").at(-1);
  if (!tripId) throw new Error("course departure missing");
  await page.goto(walkInFormPath("blue-mantis", tripId));
  await page.getByRole("button", { name: "Add another person" }).click();
  await page.getByRole("group", { name: "Person 2" }).getByLabel("Full name").fill("Morgan Course");
  await page.getByLabel("Full name").first().fill("Alex Course");
  await expect(page.getByLabel("Full name").first()).toHaveValue("Alex Course");
  await page.getByRole("button", { name: "Add to boat" }).click();
  await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers$/);
  await page.getByRole("button", { name: "Show waiver QR code for Alex Course" }).click();
  const dialog = page.getByRole("dialog", { name: "Party waivers" });
  const src = await dialog.getByRole("img").getAttribute("src");
  if (!src?.startsWith("data:image/png;base64,")) throw new Error("QR image missing");
  const png = Buffer.from(src.slice("data:image/png;base64,".length), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!decoded) throw new Error("QR could not be decoded");
  const phoneContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const phone = makeActivitySafe(await phoneContext.newPage());
    await phone.goto(new URL(decoded.data).pathname).catch(() => {
      throw new Error("course waiver navigation failed");
    });
    await dialog.getByRole("button", { name: "Close" }).click();
    await phone.getByLabel("Type your full name").fill("Alex Course");
    await phone.getByLabel("I have read this waiver, understand it, and agree to it.").check();
    const no = phone.getByRole("radio", { name: "No" });
    await expect(no).not.toHaveCount(0);
    for (const radio of await no.all()) await radio.check();
    await phone.getByRole("button", { name: "Sign waiver" }).click();
    await expect(phone.getByRole("heading", { name: "Waiver signed" })).toBeVisible();
    await expect(phone.getByText("That’s the paperwork done")).toHaveCount(0);
    await expect(phone.locator('a[href^="/ready/"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Back to departure" }).click();
    await expect(rosterRow(page, "Alex Course").locator("[data-course-forms-owed]")).toHaveCount(1);
  } finally {
    await phoneContext.close();
  }
});
