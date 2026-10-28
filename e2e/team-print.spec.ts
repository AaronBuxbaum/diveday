import { expect, signedInAsOwner, test } from "./fixtures";

test.describe("Team on paper", () => {
  signedInAsOwner();

  test("omits empty collapsed facts while preserving their open editors", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings/team");
    const languages = page.locator('details[id^="languages-"]').first();
    const contact = page.locator('details[id^="emergency-contact-"]').last();
    await expect(languages).toBeVisible();
    await expect(contact).toBeVisible();
    await expect(contact.locator('input[name="emergencyContactName"]')).toHaveValue("");
    await page.emulateMedia({ media: "print" });
    await expect(languages).not.toBeVisible();
    await expect(contact).not.toBeVisible();
    await expect(page.getByText("Marisol Reyes (wife)", { exact: true })).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await languages.locator("summary").click();
    await contact.locator("summary").click();
    await contact.locator('input[name="emergencyContactName"]').fill("Print draft contact");
    await page.emulateMedia({ media: "print" });
    await expect(languages).toBeVisible();
    await expect(contact).toBeVisible();
    await expect(contact.locator('input[name="emergencyContactName"]')).toHaveValue(
      "Print draft contact",
    );
    await expect(languages).toHaveAttribute("open", "");
    await expect(contact).toHaveAttribute("open", "");
  });

  test("keeps roster facts and an opened credential ledger while hiding creation controls", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/team");
    const invite = page.locator("#invite");
    const addCredential = page.locator("#add-credential");
    await expect(invite).toBeVisible();
    await expect(addCredential).toBeVisible();
    const ledger = page.locator('details[id^="credentials-"]').first();
    await ledger.locator(":scope > summary").click();
    const credential = ledger.locator("li").first();
    await expect(credential).toBeVisible();
    const credentialName = await credential.locator("span.font-medium").first().innerText();
    const controls = ledger.locator("button, a");
    await page.emulateMedia({ media: "print" });
    await expect(invite).not.toBeVisible();
    await expect(addCredential).not.toBeVisible();
    await expect(page.getByText("Dana Reyes", { exact: true })).toBeVisible();
    await expect(page.getByText("Marisol Reyes (wife)", { exact: true })).toBeVisible();
    await expect(credential.getByText(credentialName, { exact: true })).toBeVisible();
    await expect(controls).not.toHaveCount(0);
    for (const control of await controls.all()) {
      await expect(control).not.toBeVisible();
    }
    const pdf = await page.pdf({ format: "Letter", preferCSSPageSize: true });
    await test
      .info()
      .attach("team-open-credentials.pdf", { body: pdf, contentType: "application/pdf" });
    await page.emulateMedia({ media: "screen" });
    await expect(invite).toBeVisible();
    await expect(addCredential).toBeVisible();
  });
});
