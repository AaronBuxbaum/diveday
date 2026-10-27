import jsQR from "jsqr";
import sharp from "sharp";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { counterPath, seededTripId, walkInFormPath } from "./helpers";

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
  await page.getByLabel("Full name").first().fill("Alex Lagoon");
  await page.getByRole("button", { name: "Add another person" }).click();
  const child = page.getByRole("group", { name: "Person 2" });
  await child.getByLabel("Full name").fill("Sky Lagoon");
  await child.getByLabel(/Under 18/).check();
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
    await phone.goto(url.pathname);
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
    await expect(phone.getByRole("heading", { name: /paperwork done/ })).toBeVisible();
    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: "Sky Lagoon" });
    await expect(row.getByText("Waiver signed", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to departure" }).click();
    await expect(page).toHaveURL(counterPath("blue-mantis", tripId));
  } finally {
    await phoneContext.close();
  }
});
