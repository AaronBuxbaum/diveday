import { expect, test } from "./fixtures";

// A freshly onboarded shop is the real "empty shop" scenario the first-run
// checklist exists for — the seeded demo shop never reaches this state, so
// this spec drives the actual onboarding flow rather than relying on seed data.
test("a freshly onboarded shop sees a first-run checklist on Today, and a step checks off from real data", async ({
  page,
}) => {
  const unique = `first-run-${Date.now()}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("First Run E2E");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));

  await expect(page.getByRole("heading", { name: "Get your shop ready" })).toBeVisible();
  await expect(page.getByText("Add your contact details")).toBeVisible();
  await expect(page.getByText("Add your first dive site")).toBeVisible();
  await expect(page.getByText("Schedule your first trip")).toBeVisible();
  await expect(page.getByText("Share your public schedule")).toBeVisible();
  await expect(page.getByText("Connect Stripe (optional)")).toBeVisible();
  // A brand-new shop has completed none of the five steps yet.
  await expect(page.getByText("Done", { exact: true })).toHaveCount(0);

  // Complete the contact-details step for real, through the actual settings
  // form — not a flag the checklist sets itself — then confirm it reflects.
  await page.getByRole("link", { name: "Add contact details" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}/settings$`));
  await page.getByLabel("Contact email").fill("hello@firstrun.example.com");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await expect(page.getByText("Contact details saved.")).toBeVisible();

  await page.goto(`/shop/${unique}`);
  await expect(page.getByText("Contact details on file.")).toBeVisible();
  await expect(page.getByText("Add your first dive site")).toBeVisible();

  // The schedule-link step always offers the link, independent of "done" state.
  await expect(page.getByText(`/shop/${unique}/schedule`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
});
