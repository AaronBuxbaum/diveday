import { expect, test } from "./fixtures";
import { E2E_APP_HOST } from "./servers";

/** The origin the fleet advertises, as the shop-link hint prints it: no scheme. */
const STOREFRONT_HOST = new URL(E2E_APP_HOST).host;

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
  // The one decision sign-up asks an owner to make is what their web address
  // will be, so the line under the box *is* that address, written as they type
  // (ADR 20260827-first-light, decision 1). Asserted before the submit,
  // because after it there is nothing left to have shown them. The address is
  // matched exactly, on its own element, so the assertion cannot be satisfied
  // by a paragraph that merely mentions the slug.
  const storefront = page.getByText(`${STOREFRONT_HOST}/s/${unique}`, { exact: true });
  await expect(storefront).toBeVisible();
  await expect(storefront.locator("xpath=..")).toHaveText(
    `Your schedule will live at ${STOREFRONT_HOST}/s/${unique}`,
  );
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

  // The setup ledger is the spine's leading group, under its own group label
  // (ADR 20260827-first-light, decision 6) — not a card standing where the
  // day's work would be.
  await expect(page.getByRole("heading", { name: "First morning" })).toBeVisible();
  await expect(page.getByText("Add your contact details")).toBeVisible();
  await expect(page.getByText("Add your first dive site")).toBeVisible();
  await expect(page.getByText("Put a departure on the board")).toBeVisible();
  await expect(page.getByText("Share your public schedule")).toBeVisible();
  await expect(page.getByText("Connect payments", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("0 of 5 done")).toBeVisible();
  await expect(page.locator('[data-first-run-primary="true"]')).toHaveCount(1);
  await expect(page.locator('[data-first-run-primary="true"]')).toHaveText("Add contact details");
  // A brand-new shop has completed none of the steps yet.
  await expect(page.getByText("Done", { exact: true })).toHaveCount(0);

  // Regression: the "No boats out today" card used to render here with its
  // heading and nothing else — an empty bordered box as the owner's first
  // screen. With the checklist on screen (which owns "schedule your first
  // trip"), the card sits out entirely.
  await expect(page.getByRole("heading", { name: "No boats out today" })).toHaveCount(0);

  // ...and neither does the queue's own empty state, which is written for the
  // shop that cleared its last blocker: "Every diver booked in the next week
  // has their waiver, certifications, and payment in order. Enjoy the surface
  // interval." This shop has no divers, and read that directly beneath the
  // step telling it to schedule its first trip (issue #711). The header
  // sentence went with it — "No boats out today" is a quiet Tuesday, not a
  // shop with no board.
  await expect(page.getByRole("heading", { name: "Nothing is waiting on you" })).toHaveCount(0);
  await expect(page.getByText(/surface interval/i)).toHaveCount(0);
  await expect(page.getByText(/No boats out today/)).toHaveCount(0);

  // Complete the contact-details step for real, through the actual settings
  // form — not a flag the checklist sets itself — then confirm it reflects.
  // The checklist deep-links to the contact row's fragment, which opens the
  // row — the settings hub keeps its forms behind summary rows.
  await page.getByRole("link", { name: "Add contact details" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}/settings#contact$`));
  await page.getByLabel("Contact email").fill("hello@firstrun.example.com");
  await page.getByRole("button", { name: "Save contact details" }).click();
  await expect(page.getByText("Contact details saved.")).toBeVisible();

  await page.goto(`/shop/${unique}`);
  await expect(page.getByText("Contact details on file.")).toBeVisible();
  await expect(page.getByText("1 of 5 done")).toBeVisible();
  await expect(page.locator('[data-first-run-primary="true"]')).toHaveCount(1);
  await expect(page.locator('[data-first-run-primary="true"]')).toHaveText("Set up profile");
  await expect(page.getByText("Add your first dive site")).toBeVisible();

  // Every open step that is not the next one is the row itself — its
  // destination named on the stretched link, no button (principle 10). The
  // site step points at the **library**, whose two-door empty state is where a
  // shop chooses between writing a site and copying a published one.
  await expect(page.getByRole("link", { name: "Add a dive site" })).toHaveAttribute(
    "href",
    `/shop/${unique}/dive-sites`,
  );

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

  // The zone was accepted (an invalid one bounces back to the form) and is
  // persisted on the new shop. First-run intentionally leads with its setup
  // surface instead of the time-of-day greeting, so verify the stored value
  // directly in the settings editor (the same value drives every later Today
  // greeting).
  await expect(page).toHaveURL(new RegExp(`/shop/${unique}$`));
  await expect(page.getByRole("heading", { name: "Your shop is live." })).toBeVisible();
  await page.goto(`/shop/${unique}/settings#timezone`);
  await expect(page.locator('select[name="timezone"]')).toHaveValue("Asia/Jayapura");
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
  test.setTimeout(30_000);
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

  // Divers: nobody on file. The roster's search is also the quick-add door;
  // typing a name and choosing Add diver creates the record and opens it.
  await page.goto(`/shop/${unique}/divers`);
  await expect(page.getByText("No divers on file yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Import your roster" })).toHaveAttribute(
    "href",
    `/shop/${unique}/settings/import`,
  );
  await page.getByRole("searchbox", { name: "Search divers" }).fill("First Empty Diver");
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  // `?edit=1` opens the one-shot disclosure and FlashParams removes it after
  // the detail page paints, so the settled URL may or may not retain it.
  await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "First Empty Diver" })).toBeVisible();
  await expect(page.getByLabel("Date of birth")).toBeVisible();

  // Orders: no orders and no connected account, so the one honest door is the
  // money settings — the same fork the page header already makes, now inside
  // the card a shop with nothing actually reads.
  await page.goto(`/shop/${unique}/orders`);
  await expect(
    page.getByText(
      // One noun for one object: the record the front desk sends is an
      // "order" wherever it is named — "invoice" is only the Stripe artifact.
      "No DiveDay orders yet — connect payments and the front desk can send its first order from here.",
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

  /**
   * **The timezone had already answered two more questions.** A shop that said
   * `America/Cancun` was created pricing in dollars, and nothing on the setup
   * checklist mentioned it — so it could publish its page, take a booking and
   * run a boat before finding out, by which point the prices it typed are
   * stored as minor units of the wrong currency (issue #712).
   */
  test("is started on pesos, and asked to check before it prices anything", async ({ page }) => {
    test.setTimeout(60_000);
    const unique = "cozumel-units";
    await page.goto("/onboard");
    await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Cozumel Divers");
    await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
    await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Rosa Mendez");
    await page
      .locator('input[name="ownerEmail"]')
      .filter({ visible: true })
      .fill(`${unique}@example.com`);
    await page
      .locator('input[name="ownerPassword"]')
      .filter({ visible: true })
      .fill("pass-123-abc");
    await page.getByRole("button", { name: "Create shop & start trial" }).click();
    await page.waitForURL(new RegExp(`/shop/${unique}$`));

    // The checklist names the guess rather than only inviting a look — a step
    // saying "check your units" without saying what they are makes a shop
    // navigate to find out whether it needs to.
    await expect(page.getByText("Check your currency and depth unit")).toBeVisible();
    await expect(page.getByText(/MXN and metres/)).toBeVisible();

    // ...and the shop row itself agrees, which is the assertion that the
    // derivation reached the database rather than only the checklist copy. The
    // Units row's own closed summary is where a shop reads it back.
    await page.goto(`/shop/${unique}/settings`);
    await expect(page.getByText(/Metres \(m\).*MXN/)).toBeVisible();
  });
});
