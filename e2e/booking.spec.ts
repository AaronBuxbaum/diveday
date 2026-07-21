import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, signInAsOwner } from "./helpers";

test.describe("staff", () => {
  signedInAsOwner();

  test("full loop: staff schedules, visitor books, staff sees the roster", async ({ page }) => {
    const title = `Eagle Ray Run ${Date.now()}`;

    // Staff puts a trip on the board.
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:30");
    await page.getByLabel("Capacity").fill("6");
    await page.getByLabel(/Price per diver/).fill("120");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner (param is one-shot)
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    // A visitor books it from the public schedule — no account.
    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("6 spots left")).toBeVisible();
    await expect(page.getByText("$120.00")).toBeVisible();
    const partySize = page.getByLabel("Number of divers");
    await expect(partySize).toHaveAttribute("data-hydrated", "true");
    await partySize.selectOption("2");
    await page.getByLabel("Name", { exact: true }).fill("Nora Quinn");
    await page.getByLabel("Email", { exact: true }).fill(`nora-${Date.now()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Sam Quinn");
    await page.getByLabel("Diver 2 email").fill(`sam-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

    // WP-3: the confirmation takes the top — it sits above the pre-trip content
    // (pack list, briefings), not buried at the bottom of a long page.
    const confirmationBox = await page
      .getByRole("heading", { name: /You're on the boat, Nora/ })
      .boundingBox();
    const packBox = await page.getByRole("heading", { name: "Pack with confidence" }).boundingBox();
    expect(confirmationBox?.y ?? 0).toBeLessThan(packBox?.y ?? Number.POSITIVE_INFINITY);

    // Both named spots are held atomically.
    await page.goto("/shop/blue-mantis/schedule");
    const card = page.locator("li").filter({ hasText: title });
    await expect(card.getByText("4 spots left")).toBeVisible();

    // Staff sees the diver on the roster. Today is a work queue, so open the trip
    // from the schedule (staff cards link straight to the management view). This
    // leg re-walks the real sign-in form on purpose: the loop is the point.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("Nora Quinn").first()).toBeVisible();
    await expect(page.getByText("Sam Quinn").first()).toBeVisible();
  });

  test("staff edits a trip and cancelling removes it from the public schedule", async ({
    page,
  }) => {
    const title = `Drift Dive ${Date.now()}`;
    const renamed = `${title} (PM)`;

    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(6));
    await page.getByLabel("Departs").fill("13:00");
    await page.getByLabel("Returns").fill("16:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner (param is one-shot)

    // Edit the title from the manage page (opened from the schedule). Staff are
    // routed to the editable trip view, never the public booking form.
    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByRole("button", { name: "Book my spot" })).toHaveCount(0);
    await page.getByLabel("Title").fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Changes saved");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    const manageUrl = page.url();

    // Cancel: gone from public schedule; reinstate: back.
    await page.getByRole("button", { name: "Cancel trip" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await page.goto("/shop/blue-mantis/schedule");
    await expect(page.locator("li").filter({ hasText: renamed })).toHaveCount(0);

    await page.goto(manageUrl);
    await page.getByRole("button", { name: "Reinstate trip" }).click();
    await expect(page.getByRole("status")).toContainText("Back on");
    await page.goto("/shop/blue-mantis/schedule");
    await expect(page.locator("li").filter({ hasText: renamed })).toBeVisible();
  });
});

test("a full boat lets a diver join the wait list without taking a seat", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  // Seeded wreck trip ships full (10 of 10).
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { name: "This boat's full" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the wait list" })).toBeVisible();
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill(`waitlist-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Join the wait list" }).click();
  await expect(page.getByRole("heading", { name: /You're on the wait list, Nora/ })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { name: "Wait list" })).toBeVisible();
  await expect(page.getByText("Nora Quinn").last()).toBeVisible();
});
