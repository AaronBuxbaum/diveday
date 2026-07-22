import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, signInAsOwner } from "./helpers";

signedInAsOwner();

test("staff schedules a trip and it appears on shop and public schedules", async ({ page }) => {
  // Unique per run: the dev database persists across e2e runs.
  const title = `Turtle Reef Special ${Date.now()}`;

  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: "Schedule a trip" }).click();
  await expect(page.getByRole("heading", { name: "Schedule a trip" })).toBeVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:30");
  await page.getByLabel("Capacity").fill("8");
  await page.getByLabel("Number of dives").selectOption("3");
  await page.getByLabel("Name").nth(0).fill("Morning reef");
  await page
    .getByLabel("Diver-facing details")
    .nth(1)
    .fill("Second site details will be confirmed at the dock.");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("status")).toBeVisible(); // created banner (param is one-shot)
  await expect(page.getByRole("status")).toContainText(title);

  // View as a diver: signed in, /schedule/[id] renders the staff editor; the
  // public dive-plan briefing ("Your N-dive plan") is the signed-out view.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  const card = page.locator("li").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("8 spots left")).toBeVisible();

  await card.click();
  await expect(page.getByRole("heading", { name: "Your 3-dive plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning reef" })).toBeVisible();
  await expect(page.getByText("Second site details will be confirmed at the dock.")).toBeVisible();

  // Cancel the trip: the dev database persists across runs, and an
  // uncancelled trip stays on the public schedule forever, which is what was
  // making the schedule Argos snapshot (e2e/visual.spec.ts) flake on this
  // timestamped title every run.
  const tripUrl = page.url();
  await signInAsOwner(page);
  await page.goto(tripUrl);
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Cancel trip" }).click();
  await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
});

test("end-before-start is rejected with a friendly message", async ({ page }) => {
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill("Backwards Trip");
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("12:00");
  await page.getByLabel("Returns").fill("09:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "end after it starts" })).toBeVisible();
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { name: "Backwards Trip" })).not.toBeVisible();
});
