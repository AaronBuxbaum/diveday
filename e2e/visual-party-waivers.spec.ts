import jsQR from "jsqr";
import sharp from "sharp";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { seededTripId, walkInFormPath } from "./helpers";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({ ...VISUAL_STEP_BOUNDS, screenshot: "off", trace: "off" });
const t = staffTranslator("en-US");
signedInAsOwner();

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      test(`the party waiver queue shows each person's next step (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Benwood & Elbow", {
          daysOut: 3,
        });
        await page.goto(walkInFormPath("blue-mantis", tripId));
        await page.getByRole("button", { name: "Add another person" }).click();
        const child = page.getByRole("group", { name: "Person 2" });
        const childName = scheme === "light" ? "Sky Light" : "Sky Dark";
        await child.getByLabel("Full name").fill(childName);
        await child.getByLabel(/Under 18/).check();
        const leadName = scheme === "light" ? "Alex Light" : "Alex Dark";
        await page.getByLabel("Full name").first().fill(leadName);
        await expect(page.getByLabel("Full name").first()).toHaveValue(leadName);
        await page.getByRole("button", { name: "Add to boat" }).click();
        await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers$/);
        await expect(page.getByText(childName, { exact: true })).toBeVisible();
        // No QR is opened: the screenshot never contains a live bearer credential.
        await capture(page, "party-waiver-queue", scheme);
      });
      test(`held identity and medical follow-up in the party queue (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
      }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Benwood & Elbow", {
          daysOut: 3,
        });
        await page.goto(walkInFormPath("blue-mantis", tripId));
        await page.getByRole("button", { name: "Add another person" }).click();
        await page
          .getByRole("group", { name: "Person 2" })
          .getByLabel("Full name")
          .fill("Zoe Bennet");
        const leadName = scheme === "light" ? "Avery Light" : "Avery Dark";
        await page.getByLabel("Full name").first().fill(leadName);
        await page.getByRole("button", { name: "Add to boat" }).click();
        await expect(page.getByText(t("divers.page.partyOnFile"))).toBeVisible();
        await page.getByRole("radio", { name: /Use the record on file/ }).check();
        await page.getByRole("button", { name: "Add to boat" }).click();
        await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers$/);
        await expect(page.getByText("Identity needs confirmation")).toBeVisible();
        await page.getByRole("button", { name: `Show waiver QR code for ${leadName}` }).click();
        const dialog = page.getByRole("dialog", { name: "Party waivers" });
        const src = await dialog.getByRole("img").getAttribute("src");
        if (!src?.startsWith("data:image/png;base64,")) throw new Error("QR missing");
        const pixels = await sharp(
          Buffer.from(src.slice("data:image/png;base64,".length), "base64"),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const decoded = jsQR(
          new Uint8ClampedArray(pixels.data),
          pixels.info.width,
          pixels.info.height,
        );
        if (!decoded) throw new Error("QR could not be decoded");
        const phoneContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: { cookies: [], origins: [] },
        });
        try {
          const phone = makeActivitySafe(await phoneContext.newPage());
          await phone.goto(new URL(decoded.data).pathname).catch(() => {
            throw new Error("waiver navigation failed");
          });
          await dialog.getByRole("button", { name: "Close" }).click();
          await phone.getByLabel("Type your full name").fill(leadName);
          await phone
            .getByLabel("I have read this waiver, understand it, and agree to it.")
            .check();
          const no = phone.getByRole("radio", { name: "No" });
          await expect(no).not.toHaveCount(0);
          for (const radio of await no.all()) await radio.check();
          await phone
            .locator("fieldset")
            .filter({ visible: true })
            .nth(2)
            .getByRole("radio", { name: "Yes" })
            .check();
          await phone.getByRole("button", { name: "Sign waiver" }).click();
          await expect(phone.getByRole("heading", { name: "Waiver received" })).toBeVisible();
          await page.reload();
          await expect(page.getByText("Waiver signed · medical review needed")).toBeVisible();
          await expect(page.getByRole("link", { name: "Confirm identity" })).toBeVisible();
          await expect(page.getByRole("link", { name: "Review medical status" })).toBeVisible();
          // The QR is closed before capture, so no bearer credential enters an artifact.
          await capture(page, "party-waiver-held-medical", scheme);
        } finally {
          await phoneContext.close();
        }
      });
    });
  });
}
