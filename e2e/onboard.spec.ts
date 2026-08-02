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

// Sign-up used to offer sixteen hand-listed zones, so a shop in Raja Ampat,
// Bonaire, or the Maldives hit a hard stop at the last step of signing up —
// the field is required and their zone was not in it. The server never had
// that restriction (`onboardSchema` accepts any zone `isValidTimeZone`
// recognizes), so this drives the offering side: pick a zone that was never on
// the old list, and check the shop is really keeping time there.
test("a shop outside the curated dive regions can pick its own timezone", async ({ page }) => {
  const unique = `raja-ampat-${Date.now()}`;
  await page.goto("/onboard");

  // Both tiers are on offer: the pinned dive-region shortcuts, and every other
  // zone the runtime knows.
  const timezone = page.locator('select[name="timezone"]').filter({ visible: true });
  await expect(timezone).toHaveValue("America/New_York");
  await expect(timezone.locator('optgroup[label="Caribbean & Mexico"]')).toBeAttached();
  await expect(timezone.locator('optgroup[label="All timezones"]')).toBeAttached();
  await timezone.selectOption("Asia/Jayapura");
  await expect(timezone).toHaveValue("Asia/Jayapura");

  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Raja Ampat E2E");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Sari Wibowo");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`${unique}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();

  // The zone was accepted (an invalid one bounces back to the form with an
  // error) and it is what the new shop reads the clock in: the frozen harness
  // instant is mid-morning in New York and late evening in Papua, so the
  // greeting proves the stored zone rather than the default.
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));
  await expect(page.getByRole("heading", { name: /Good night, Sari/ })).toBeVisible();
});
