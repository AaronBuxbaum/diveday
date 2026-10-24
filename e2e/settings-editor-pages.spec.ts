import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

const staff = staffTranslator("en-US");

async function openEditor(page: Page, id: string) {
  const row = page.locator(`#${id}`);
  if ((await row.getAttribute("open")) === null) await row.locator("summary").click();
}

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
  for (const [name, href] of [
    ["Boats", `/shop/${SHOP}/boats`],
    ["Trip tags", `/shop/${SHOP}/trip-tags`],
    [staff("reports.bookkeeper.label"), `/shop/${SHOP}/settings/bookkeeper`],
    // Forms of six to a dozen fields, pages of their own since #1854.
    ["Rentals", `/shop/${SHOP}/settings/rentals`],
    ["Emergency reference", `/shop/${SHOP}/settings/emergency-reference`],
    ["Dock-day rhythm", `/shop/${SHOP}/settings/dock-day`],
    ["Shop profile & branding", `/shop/${SHOP}/settings/profile`],
  ] as const) {
    await expect(main.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }

  // And the hub is a directory: none of the editors' controls is on it.
  await expect(main.getByRole("button", { name: "Add a boat" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Add package" })).toHaveCount(0);
  for (const save of ["Save emergency reference", "Save profile"]) {
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
  await expect(page.getByLabel("Vessel", { exact: true })).not.toBeVisible();
  await openEditor(page, "emergency-response");
  await page.getByLabel("Vessel", { exact: true }).fill("Second Wind, white hull, blue canopy");
  await page.getByRole("button", { name: "Save emergency reference" }).click();

  // Asserted on the banner and the heading, not the URL, for the reason the
  // boats test above gives (`FlashParams`).
  await expect(page.getByText("Emergency reference saved")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Emergency reference" })).toBeVisible();
  await expect(page.locator("#emergency-response summary")).toContainText(
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
  await openEditor(page, "emergency-alerts");
  const address = page.getByLabel("Shore contact’s email for roll-call alerts");
  const consent = page.getByRole("checkbox", { name: /They agreed to get these alerts/ });
  await address.fill("shore@example.com");
  await consent.check();
  await page.getByRole("button", { name: "Save emergency reference" }).click();

  await expect(page.getByText(staff("settings.main.notice.shoreAlertSavedDemo"))).toBeVisible();
  await openEditor(page, "emergency-alerts");
  await expect(address).toHaveValue("shore@example.com");
  await expect(consent).toBeChecked();
  await expect(page.getByText(/^Recorded .+ by /)).toBeVisible();

  await address.fill("");
  await page.getByRole("button", { name: "Save emergency reference" }).click();
  await expect(page.getByText(staff("settings.main.notice.shoreAlertCleared"))).toBeVisible();
  await openEditor(page, "emergency-alerts");
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

  await expect(page.getByRole("button", { name: "Add a boat", exact: true })).not.toBeVisible();
  await openEditor(page, "boat-new");
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
  await expect(page.getByText("Boat created")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Boats" })).toBeVisible();
  const row = page.locator("details").filter({ has: page.locator('input[value="Second Wind"]') });
  await expect(row.locator("summary")).toContainText("Second Wind");
  await expect(row.getByLabel("Boat name")).not.toBeVisible();
  await row.locator("summary").click();
  await row.getByLabel("Boat name").fill("Second Wind II");
  await row.getByRole("button", { name: staff("boats.submit"), exact: true }).click();
  await expect(page.getByText(staff("boats.boatUpdated"))).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Second Wind II" })).toBeVisible();
});

test("a package is added on Promos, and the save lands back on its section", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  // The old address is kept for bookmarks and lands on Promos' packages
  // section (visual review 2026-10-24, A26).
  await page.goto(`/shop/${SHOP}/promos/packages`);
  await expect(page).toHaveURL(`/shop/${SHOP}/promos#dive-packages`);
  await expect(page.getByRole("heading", { level: 2, name: "Dive packages" })).toBeVisible();

  await expect(page.getByLabel("What you call it")).not.toBeVisible();
  await openEditor(page, "package-new");
  await page.getByLabel("What you call it").fill("Ten-dive card");
  await page.getByLabel("Dives included").fill("10");
  await page.getByLabel("Price").fill("450");
  await page.getByRole("button", { name: "Add package" }).click();

  await expect(page.getByText("Package added")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Dive packages" })).toBeVisible();
  const packageRow = page.getByRole("listitem").filter({ hasText: "Ten-dive card" });
  await expect(packageRow).toContainText("10 dives");
  await expect(packageRow).toContainText("$450");
  await expect(packageRow).toContainText("Fun dives only");
  await packageRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(staff("settings.main.notice.packageDeleted"))).toBeVisible();
  await expect(page.getByText("Ten-dive card")).not.toBeVisible();
});

test("trip tags read as names and open rename, delete and add on intent", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/shop/${privateShop.slug}/trip-tags`);
  await expect(page.locator("#tag-new summary")).toBeVisible();
  await expect(page.locator("#tag-new").getByLabel(staff("lenses.nameLabel"))).not.toBeVisible();
  await openEditor(page, "tag-new");
  await page.locator("#tag-new").getByLabel(staff("lenses.nameLabel")).fill("Sunset reef");
  await page
    .locator("#tag-new")
    .getByRole("button", { name: staff("lenses.add"), exact: true })
    .click();
  await expect(page.getByText(staff("lenses.created"))).toBeVisible();
  const row = page.locator("details").filter({ has: page.locator('input[value="Sunset reef"]') });
  await expect(row.locator("summary")).toHaveText("Sunset reef");
  await expect(row.getByLabel(staff("lenses.nameLabel"))).not.toBeVisible();
  await row.locator("summary").click();
  const add = page.locator("#tag-new");
  if ((await add.getAttribute("open")) !== null) await add.locator("summary").click();
  await row.getByLabel(staff("lenses.nameLabel")).fill("   ");
  await row.getByRole("button", { name: staff("lenses.submit"), exact: true }).click();
  await expect(page.getByText(staff("lenses.invalid"))).toBeVisible();
  await expect(row).toHaveJSProperty("open", true);
  await expect(add).toHaveJSProperty("open", false);
  await row.getByLabel(staff("lenses.nameLabel")).fill("Sunset shore");
  // Enter must rename, never invoke the neighboring delete action.
  await row.getByLabel(staff("lenses.nameLabel")).press("Enter");
  await expect(page.getByText(staff("lenses.updated"))).toBeVisible();
  const renamed = page
    .locator("details")
    .filter({ has: page.locator('input[value="Sunset shore"]') });
  await expect(renamed.locator("summary")).toHaveText("Sunset shore");
  if ((await renamed.getAttribute("open")) === null) await renamed.locator("summary").click();
  await renamed.getByRole("button", { name: staff("lenses.delete"), exact: true }).click();
  await expect(
    renamed.getByRole("button", { name: staff("lenses.deleteConfirm"), exact: true }),
  ).toHaveAttribute("type", "submit");
  await renamed.getByRole("button", { name: staff("lenses.deleteConfirm"), exact: true }).click();
  await expect(page.getByText(staff("lenses.deleted"))).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Sunset shore" })).not.toBeVisible();
});

test("editing one emergency contact preserves the closed contacts and response plan", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/shop/${privateShop.slug}/settings/emergency-reference`);
  // Private shops start with an empty reference. Establish the saved facts
  // through the same add/save path whose closed-row submission this guards.
  await openEditor(page, "emergency-contact-new");
  await page.locator('#emergency-contact-new input[name^="emergencyLabel-"]').fill("Chamber");
  await page.locator('#emergency-contact-new input[name^="emergencyPhone-"]').fill("+13055550181");
  await openEditor(page, "emergency-response");
  await page
    .getByLabel(staff("settings.main.emergency.vesselLabel"), { exact: true })
    .fill("Second Wind, white hull");
  await page
    .getByLabel(staff("settings.main.emergency.shoreContactLabel"), { exact: true })
    .fill("Mara at the dock, +13055550183");
  await page
    .getByLabel(staff("settings.main.emergency.planLabel"), { exact: true })
    .fill("Call rescue; return to north dock.");
  await page.getByRole("button", { name: staff("settings.main.emergency.submit") }).click();
  await expect(page.locator("#emergency-contact-0 summary")).toContainText("Chamber");
  await expect(page.locator("#emergency-contact-0 summary")).toContainText("+13055550181");
  await expect(page.locator("#emergency-response summary")).toContainText(
    "Second Wind, white hull",
  );
  await expect(page.locator("#emergency-response summary")).toContainText(
    "Mara at the dock, +13055550183",
  );
  await expect(page.locator("#emergency-response summary")).toContainText(
    "Call rescue; return to north dock.",
  );

  await openEditor(page, "emergency-contact-new");
  await page.locator('#emergency-contact-new input[name^="emergencyLabel-"]').fill("Coast guard");
  await page.locator('#emergency-contact-new input[name^="emergencyPhone-"]').fill("+13055550182");
  await page.getByRole("button", { name: staff("settings.main.emergency.submit") }).click();
  await expect(page.locator("#emergency-contact-1 summary")).toContainText("Coast guard");
  await expect(page.locator("#emergency-contact-1 summary")).toContainText("+13055550182");
  await page.reload();
  const labels = page.locator('input[name^="emergencyLabel-"]');
  const phones = page.locator('input[name^="emergencyPhone-"]');
  await expect(labels).not.toHaveCount(0);
  await expect(phones).not.toHaveCount(0);
  const savedLabels: string[] = [];
  const savedPhones: string[] = [];
  for (const field of await labels.all()) savedLabels.push(await field.inputValue());
  for (const field of await phones.all()) savedPhones.push(await field.inputValue());
  const vessel = await page.locator('input[name="emergencyVessel"]').inputValue();
  const plan = await page.locator('textarea[name="emergencyPlan"]').inputValue();
  const shoreContact = await page.locator('input[name="emergencyShoreContact"]').inputValue();
  expect(vessel).toBe("Second Wind, white hull");
  expect(shoreContact).toBe("Mara at the dock, +13055550183");
  expect(plan).toBe("Call rescue; return to north dock.");
  expect(savedLabels.filter(Boolean).length).toBeGreaterThan(1);
  const first = labels.first();
  await expect(first).not.toBeVisible();
  await first.locator("xpath=ancestor::details[1]").locator("summary").click();
  await first.fill("Local rescue");
  await page.getByRole("button", { name: staff("settings.main.emergency.submit") }).click();
  await expect(page.getByText(staff("settings.main.notice.emergencySaved"))).toBeVisible();
  await page.reload();
  await expect(labels.first()).toHaveValue("Local rescue");
  for (let index = 1; index < savedLabels.length; index += 1) {
    await expect(labels.nth(index)).toHaveValue(savedLabels[index]);
  }
  for (let index = 0; index < savedPhones.length; index += 1) {
    await expect(phones.nth(index)).toHaveValue(savedPhones[index]);
  }
  await expect(page.locator('input[name="emergencyVessel"]')).toHaveValue(vessel);
  await expect(page.locator('textarea[name="emergencyPlan"]')).toHaveValue(plan);
  await expect(page.locator('input[name="emergencyShoreContact"]')).toHaveValue(shoreContact);
  await expect(page.locator("summary").filter({ hasText: "Local rescue" })).toBeVisible();
  await openEditor(page, "emergency-contact-new");
  const add = page.locator("#emergency-contact-new");
  await add.locator('input[name^="emergencyLabel-"]').fill("Harbor rescue");
  await add.locator('input[name^="emergencyPhone-"]').fill("+13055550190");
  await page.getByRole("button", { name: staff("settings.main.emergency.submit") }).click();
  await expect(page.getByText(staff("settings.main.notice.emergencySaved"))).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Harbor rescue" })).toContainText(
    "+13055550190",
  );
  await expect(page.locator("summary").filter({ hasText: "Local rescue" })).toBeVisible();
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

test("bookkeeper settings and registers retain the settings rail", async ({
  page,
  privateShop,
}) => {
  const SHOP = privateShop.slug;
  for (const destination of [
    "boats",
    "dive-sites",
    "trip-tags",
    "safety-checklist",
    "waivers",
    "settings/bookkeeper",
  ]) {
    await page.goto(`/shop/${SHOP}/${destination}`);
    await expect(
      page.getByRole("navigation", { name: staff("settings.main.rail.ariaLabel") }),
    ).toBeVisible();
  }
  const email = page.getByRole("textbox", { name: staff("reports.bookkeeper.label") });
  const save = page.getByRole("button", { name: staff("reports.bookkeeper.save"), exact: true });
  const helper = page.getByText(staff("reports.bookkeeper.description"), { exact: true });
  const form = page.locator("form").filter({ has: email });
  const panel = page.getByRole("main").locator(":scope > section").filter({ has: email });
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(email).toBeVisible();
    await expect(save).toBeVisible();
    await expect(helper).toBeVisible();
    await expect(email).toHaveAttribute(
      "aria-describedby",
      (await helper.getAttribute("id")) ?? "",
    );
    const [emailBox, saveBox, helperBox, formBox, panelBox] = await Promise.all([
      email.boundingBox(),
      save.boundingBox(),
      helper.boundingBox(),
      form.boundingBox(),
      panel.boundingBox(),
    ]);
    if (!emailBox || !saveBox || !helperBox || !formBox || !panelBox) {
      throw new Error("Bookkeeper controls must have rendered bounds");
    }
    expect(Math.abs(saveBox.x - emailBox.x)).toBeLessThanOrEqual(1);
    expect(saveBox.y).toBeGreaterThanOrEqual(helperBox.y + helperBox.height);
    for (const box of [emailBox, saveBox, helperBox]) {
      for (const container of [formBox, panelBox]) {
        expect(box.x).toBeGreaterThanOrEqual(container.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(container.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(container.y + container.height + 1);
      }
    }
  }
});
