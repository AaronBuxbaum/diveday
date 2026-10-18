import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const staff = staffTranslator("en-US");

/**
 * **The settings editors that outgrew a hub row.**
 *
 * The settings hub is a directory: a row states its current answer and opens
 * the form that changes it (ADR 20260827-clearwater-surface-language, decision
 * 6). Some rows had stopped obeying that — their "form" was a *list* of forms,
 * each line carrying its own Save and Delete, behind one `⌄`. They are pages
 * now, and the hub lists them as doors.
 *
 * What this guards is the join the unit suite cannot see: that each door goes
 * where it says, that the editor still writes through the same action it always
 * did, and — the part a move like this actually breaks — that the action's
 * redirect lands the shop back on the page they were working on rather than at
 * the top of the hub.
 *
 * Every test takes a **shop of its own**. Boats, trip tags and dive packages
 * are shop *configuration*, which `resetDemoSchedule` deliberately leaves
 * standing — a hull written into blue-mantis would survive into whatever spec
 * this worker runs next, including the captures that photograph that shop
 * (ADR 20260815-per-test-private-shops).
 */

test("the hub's list editors are doors, and each opens its own page", async ({
  page,
  privateShop,
}) => {
  // A mint and a live sign-in before the first assertion.
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings`);

  const main = page.getByRole("main");
  for (const [name, segment] of [
    ["Boats", "boats"],
    ["Trip tags", "trip-tags"],
    // Forms of six to a dozen fields, pages of their own since #1854.
    ["Rentals", "rentals"],
    ["Emergency reference", "emergency-reference"],
    ["Dock-day rhythm", "dock-day"],
    ["Shop profile & branding", "profile"],
  ] as const) {
    await expect(main.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      `/shop/${SHOP}/settings/${segment}`,
    );
  }

  // And the hub is a directory: none of the editors' controls is on it.
  await expect(main.getByRole("button", { name: "Add a boat" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Add package" })).toHaveCount(0);
  for (const save of ["Save emergency reference", "Save dock-day rhythm", "Save profile"]) {
    await expect(main.getByRole("button", { name: save })).toHaveCount(0);
  }
});

test("the emergency reference saves on its own page, and the save lands back on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings/emergency-reference`);
  await expect(page.getByRole("heading", { level: 1, name: "Emergency reference" })).toBeVisible();
  await page.getByLabel("Vessel", { exact: true }).fill("Second Wind, white hull, blue canopy");
  await page.getByRole("button", { name: "Save emergency reference" }).click();

  // Asserted on the banner and the heading, not the URL, for the reason the
  // boats test above gives (`FlashParams`).
  await expect(page.getByText("Emergency reference saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Emergency reference" })).toBeVisible();
  await expect(page.getByLabel("Vessel", { exact: true })).toHaveValue(
    "Second Wind, white hull, blue canopy",
  );
});

/**
 * H-118: the shore contact's alert address saves with the box that records
 * their consent, comes back ticked with when and by whom it was recorded, and
 * clearing the address clears both and says so. The minted shop is a demo
 * shop, so the save says no confirmation link went (demo shops send nothing);
 * a real shop's link is `shore-alert-actions.test.ts`'s.
 */
test("a shore contact's alert address saves with its consent, and clears with it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/settings/emergency-reference`);
  const address = page.getByLabel("Shore contact’s email for roll-call alerts");
  const consent = page.getByRole("checkbox", { name: /They agreed to get these alerts/ });
  await address.fill("shore@example.com");
  await consent.check();
  await page.getByRole("button", { name: "Save emergency reference" }).click();

  await expect(page.getByText(staff("settings.main.notice.shoreAlertSavedDemo"))).toBeVisible();
  await expect(address).toHaveValue("shore@example.com");
  await expect(consent).toBeChecked();
  await expect(page.getByText(/^Recorded .+ by /)).toBeVisible();

  await address.fill("");
  await page.getByRole("button", { name: "Save emergency reference" }).click();
  await expect(page.getByText(staff("settings.main.notice.shoreAlertCleared"))).toBeVisible();
  await expect(address).toHaveValue("");
  await expect(consent).not.toBeChecked();
});

test("a hull is added on its own page, and the save lands back on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/boats`);
  await expect(page.getByRole("heading", { level: 1, name: "Boats" })).toBeVisible();
  // The way back up is the eyebrow, never a "Back to settings" button.
  await expect(page.getByRole("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    `/shop/${SHOP}/settings`,
  );

  const addForm = page
    .getByRole("main")
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Add a boat" }) });
  await addForm.getByLabel("Boat name").fill("Second Wind");
  await addForm.getByLabel("Capacity (seats)").fill("12");
  await addForm.getByRole("button", { name: "Add a boat" }).click();

  // The action's own redirect lands back on this page rather than at the top of
  // the hub. Asserted on the banner and the heading, not on the URL: this page
  // clears its own `?notice=` client-side once shown (`FlashParams`), so a URL
  // assertion races that cleanup.
  await expect(page.getByText("Boat created.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Boats" })).toBeVisible();
  await expect(page.getByRole("main").locator('input[value="Second Wind"]')).toHaveCount(1);
});

test("a package is added on its own page, and the save lands back on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  await page.goto(`/shop/${SHOP}/promos/packages`);
  await expect(page.getByRole("heading", { level: 1, name: "Dive packages" })).toBeVisible();

  await page.getByLabel("What you call it").fill("Ten-dive card");
  await page.getByLabel("Dives included").fill("10");
  await page.getByLabel("Price").fill("450");
  await page.getByRole("button", { name: "Add package" }).click();

  await expect(page.getByText("Package added.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Dive packages" })).toBeVisible();
  await expect(page.getByText("Ten-dive card")).toBeVisible();
});

test("the old Settings addresses of the registers redirect to where they moved", async ({
  page,
  privateShop,
}) => {
  const SHOP = privateShop.slug;
  for (const noun of ["boats", "trip-tags", "safety-checklist"]) {
    await page.goto(`/shop/${SHOP}/settings/${noun}`);
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}/${noun}$`));
  }
});
