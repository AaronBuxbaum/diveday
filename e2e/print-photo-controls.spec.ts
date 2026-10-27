import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

test.describe("photo controls on paper", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 816, height: 1056 } });

  test("keeps a chosen photo and hides the file pickers", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings/profile");
    const logo = page.locator('input[name="logoFile"]');
    const cover = page.locator('input[name="brandHeroFile"]');
    const logoPicker = page.locator('label:has(input[name="logoFile"])');
    const coverPicker = page.locator('label:has(input[name="brandHeroFile"])');
    await expect(logoPicker).toBeVisible();
    await expect(coverPicker).toBeVisible();
    const brandPreview = page.getByText(
      staffTranslator("en-US")("settings.main.profile.brandPreview"),
      {
        exact: true,
      },
    );
    await expect(brandPreview).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
    // The editor's screen spacing once left only the card border on sheet two.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
    await page.emulateMedia({ media: "screen" });
    await logo.setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(logoPicker.locator("img")).toBeVisible();
    const swapPhoto = page.getByText(staffTranslator("en-US")("shared.imageInput.chooseAnother"), {
      exact: true,
    });
    await expect(swapPhoto).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(logoPicker.locator("img")).toBeVisible();
    await expect(coverPicker).not.toBeVisible();
    await expect(swapPhoto).not.toBeVisible();
    await expect(cover).not.toBeVisible();
    await expect(brandPreview).not.toBeVisible();
  });
});

test.describe("embed settings on paper", () => {
  signedInAsOwner();

  test("keeps the embed code without the interactive preview frame", async ({ page }) => {
    await page.route(
      (url) => url.hostname === "e2e.diveday.example" && url.searchParams.get("embed") === "1",
      (route) => route.fulfill({ contentType: "text/html", body: "<p>Preview</p>" }),
    );
    await page.goto("/shop/blue-mantis/settings/embed");
    const preview = page.locator("iframe");
    await expect(preview).toBeAttached();
    // The controlled test origin has no hosted embed; complete its load so
    // the visible-preview state can be checked without an external service.
    await preview.dispatchEvent("load");
    await expect(preview).toBeVisible();
    const language = page.getByLabel(staffTranslator("en-US")("settings.embed.language"));
    await expect(language).toBeVisible();
    const selectedLanguage = await language.locator("option:checked").textContent();
    expect(selectedLanguage).toBeTruthy();
    const snippet = page.locator("textarea").first();
    await expect(snippet).toHaveValue(/<script/);
    const code = await snippet.inputValue();
    await page.emulateMedia({ media: "print" });
    await expect(preview).not.toBeVisible();
    await expect(language).not.toBeVisible();
    await expect(page.getByText(selectedLanguage ?? "", { exact: true })).toBeVisible();
    await expect(snippet).not.toBeVisible();
    await expect(page.locator("[data-print-snippet]")).toHaveText(code);
    await expect(page.locator("[data-print-snippet]")).toBeVisible();
  });
});

test.describe("activity log on paper", () => {
  signedInAsOwner();

  test("retains the current scope without printing its filter controls", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings/activity");
    const filters = page.locator("form:has(#activity-person)");
    const person = page.locator("#activity-person");
    const kind = page.locator("#activity-kind");
    await expect(filters).toBeVisible();
    const personText = await person.locator("option:checked").textContent();
    const kindText = await kind.locator("option:checked").textContent();
    expect(personText).toBeTruthy();
    expect(kindText).toBeTruthy();
    await page.emulateMedia({ media: "print" });
    await expect(filters).not.toBeVisible();
    await expect(page.getByText(new RegExp(`${personText}.*${kindText}`))).toBeVisible();
  });
});
