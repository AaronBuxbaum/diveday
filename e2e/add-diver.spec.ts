import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

signedInAsOwner();

test("staff adds a walk-in diver, then wait-lists one once the trip is full", async ({ page }) => {
  // Unique title so assertions target this spec's own trip, never a seeded
  // one. (Isolation across tests comes from the per-test demo reset in
  // fixtures.ts, not from this suffix.)
  const title = `Walk-in Test Trip ${e2eNow().getTime()}`;

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Staff view of a trip card redirects straight into the manage-trip editor.
  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  // Who is attending — and adding one — lives on the Guests tab now.
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  await addDiver.scrollIntoViewIfNeeded();
  await addDiver.getByLabel("Name").fill("Walk-in Wanda");
  await addDiver.getByLabel("Email").fill(`wanda-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to trip" }).click();

  await expect(page.getByRole("status")).toContainText("Diver added to the trip.");
  await expect(page.getByText("Walk-in Wanda")).toBeVisible();
  await expect(page.getByText("Full", { exact: true })).toBeVisible();

  // Trip is now full — the same section switches to wait-listing.
  await expect(addDiver.getByRole("button", { name: "Add to wait list" })).toBeVisible();
  await addDiver.getByLabel("Name").fill("Waitlist Wally");
  await addDiver.getByLabel("Email").fill(`wally-${e2eNow().getTime()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to wait list" }).click();

  await expect(page.getByRole("status")).toContainText("Diver added to the wait list.");
  await expect(page.getByText("Wait list").first()).toBeVisible();
  await expect(page.getByText("Waitlist Wally")).toBeVisible();

  // One-tap seat recovery: inviting the next-in-line stamps the entry so a
  // second staffer sees it's already handled. The button opens the mail
  // composer (mailto:) which the test can't follow, so we only assert the
  // recorded state lands.
  const waitlist = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Wait list" }) });
  await waitlist.getByRole("button", { name: /Email .* an invite/ }).click();
  await expect(waitlist.getByText(/Invited/)).toBeVisible();
  await expect(waitlist.getByRole("button", { name: "Re-send invite" })).toBeVisible();
});

test("staff adds a returning diver by picking them, no re-entry", async ({ page }) => {
  const title = `Returning Diver Trip ${e2eNow().getTime()}`;

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("6");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  await addDiver.scrollIntoViewIfNeeded();

  // Search the shop's existing people and add one by identity — their record,
  // not a re-typed name, lands on the roster.
  await addDiver.getByLabel("Find a returning diver").fill("Priya");
  await addDiver.getByRole("button", { name: "Search" }).click();

  const candidate = addDiver.getByRole("button", { name: "Add Priya Sharma to the trip" });
  await expect(candidate).toBeVisible();
  await candidate.click();

  await expect(page.getByRole("status")).toContainText("Diver added to the trip.");
  const roster = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Divers" }) });
  await expect(roster.getByText("Priya Sharma")).toBeVisible();

  // Picking the same diver again is no longer offered — the roster can't
  // double-book them.
  await addDiver.getByLabel("Find a returning diver").fill("Priya");
  await addDiver.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/No returning diver matches/)).toBeVisible();
});

test("staff sends waivers to a multi-selected roster in one action", async ({ page }) => {
  const title = `Bulk Waiver Trip ${e2eNow().getTime()}`;
  const stamp = e2eNow().getTime();

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(6));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("4");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).click();
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(/\/guests/);

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  for (const name of ["Bulk Bea", "Bulk Cal"]) {
    await addDiver.getByLabel("Name").fill(name);
    await addDiver
      .getByLabel("Email")
      .fill(`${name.toLowerCase().replace(/\s+/g, ".")}-${stamp}@example.com`);
    await addDiver.getByRole("button", { name: "Add to trip" }).click();
    await expect(page.getByRole("status")).toContainText("Diver added to the trip.");
  }

  // Tick both divers and send the waiver to the whole selection at once.
  await page.getByRole("checkbox", { name: "Select Bulk Bea to send a waiver" }).check();
  await page.getByRole("checkbox", { name: "Select Bulk Cal to send a waiver" }).check();
  await page.getByRole("button", { name: "Send waivers to selected" }).click();

  await expect(page.getByRole("status")).toContainText("Waiver links sent to the selected divers");
});
