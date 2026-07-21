import { expect, test } from "./fixtures";
import { daysFromNow, signInAsOwner } from "./helpers";

test("a booked diver's readiness page lets them act, and saves an emergency contact", async ({
  page,
}) => {
  const title = `Readiness Run ${Date.now()}`;

  // Staff puts a trip on the board.
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("6");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  // A visitor books it.
  await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
  await page.locator("li").filter({ hasText: title }).getByRole("link").click();
  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
  await page.getByLabel("Email", { exact: true }).fill(`nemo-${Date.now()}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat/ })).toBeVisible();

  // The confirmation hands the diver their readiness link — follow it.
  await page.getByRole("link", { name: /readiness page/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
  await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Emergency contact" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rental fit" })).toBeVisible();

  // The emergency contact is transactional now — the diver fills it in place.
  await page.getByLabel("Contact name").fill("Coral Quinn");
  await page.getByLabel("Contact phone").fill("+1 305 555 0180");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
  ).toBeVisible();
  // The row now reads as on file rather than asking again.
  await expect(page.getByText(/On file — Coral Quinn/)).toBeVisible();
});

test("a tampered readiness token reveals nothing", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
});
