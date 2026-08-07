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

  // Regression: the "No boats out today" card used to render here with its
  // heading and nothing else — an empty bordered box as the owner's first
  // screen. With the checklist on screen (which owns "schedule your first
  // trip"), the card sits out entirely.
  await expect(page.getByRole("heading", { name: "No boats out today" })).toHaveCount(0);

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
  await expect(page.getByText(`/s/${unique}`)).toBeVisible();
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
  // The fleet's browser zone is pinned to New York (playwright.config.ts), so
  // this is both the picker's default and what detection would land on — the
  // test below is the one that tells the two apart.
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

/**
 * Day one, a shop has nothing anywhere: every list it opens is empty. Those
 * empty states are the whole product at that moment, so each has to be a door
 * rather than a paragraph (docs/design/principles.md #4 — empty states teach).
 * Divers and Orders are the two checked here because they carry the two shapes
 * the rest follow: an action that opens a form already on the page, and a fork
 * on whether the shop can take money yet.
 */
test("a freshly onboarded shop finds a way forward on its empty Divers and Orders pages", async ({
  page,
}) => {
  const unique = `empty-doors-${Date.now()}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Empty Doors E2E");
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

  // Divers: nobody on file. The add form is a collapsed disclosure further up
  // the page, so the empty state's action has to open it and land the cursor
  // in it — a bare "add one here" sentence left the shop hunting for the form.
  await page.goto(`/shop/${unique}/divers`);
  await expect(page.getByText("No divers on file yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Import your roster" })).toHaveAttribute(
    "href",
    `/shop/${unique}/settings/import`,
  );
  await page.getByRole("button", { name: "Add your first diver" }).click();
  await expect(page.getByLabel("Full name")).toBeFocused();

  // Orders: no orders and no connected account, so the one honest door is the
  // money settings — the same fork the page header already makes, now inside
  // the card a shop with nothing actually reads.
  await page.goto(`/shop/${unique}/orders`);
  await expect(
    page.getByText(
      // One noun for one object: the record the front desk sends is an
      // "order" wherever it is named — "invoice" is only the Stripe artifact.
      "No orders yet — connect payments and the front desk can send its first order from here.",
    ),
  ).toBeVisible();
  // One door, once: while the unfiltered list is empty the header stands
  // down, so the empty state's action is the only Connect payments on screen
  // (docs/design/principles.md #8 — two identical primaries for one action
  // is triage work the layout should have done).
  const connect = page.getByRole("link", { name: "Connect payments" });
  await expect(connect).toHaveCount(1);
  await connect.click();
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}/settings#money$`));
});

/**
 * Every date and time a shop reads on any DiveDay surface is rendered in
 * `shops.timezone`, and this picker opened on US Eastern for everyone — so a
 * shop that clicked past it read its own schedule in someone else's zone and
 * had no way to change it afterwards. The device already knows the answer.
 */
test.describe("a shop signing up from the Caribbean", () => {
  test.use({ timezoneId: "America/Cancun" });

  test("finds its own zone already picked, and can still change it", async ({ page }) => {
    await page.goto("/onboard");
    const timezone = page.locator('select[name="timezone"]').filter({ visible: true });
    await expect(timezone).toHaveValue("America/Cancun");

    // Detection is a starting point, never a decision: the shop across the
    // channel still picks its own.
    await timezone.selectOption("America/Cayman");
    await expect(timezone).toHaveValue("America/Cayman");
  });
});
