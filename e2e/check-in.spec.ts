import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("counter check-in searches by diver, confirms live readiness, and keeps blocked rows out of the line", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/check-in");
  await expect(page.getByRole("heading", { name: "Line-busting check-in" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Check-in queue" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Scan or search diver" });
  await search.fill("Priya Sharma");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/check-in\?q=Priya\+Sharma/);

  const card = page.locator("article").filter({ hasText: "Priya Sharma" });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(card.getByText("Waiver has not been sent.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Check in Priya Sharma" })).toHaveCount(0);

  await search.fill("not-a-real-diver");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No one matches that scan" })).toBeVisible();
});

test("a counter walk-in books straight onto a boat with no email required", async ({ page }) => {
  await page.goto("/shop/blue-mantis/check-in");
  await page.getByRole("link", { name: "Walk-in" }).click();
  await expect(page.getByRole("heading", { name: "Walk-in", level: 1 })).toBeVisible();

  const tripSection = page.locator("section").filter({ hasText: "Which boat?" });
  const firstTrip = tripSection.locator("ul li a").first();
  await expect(firstTrip).toBeVisible();
  const tripText = await firstTrip.innerText();
  const tripTitle = tripText.split(" · ")[0];
  if (!tripTitle) throw new Error("could not read a trip title from the walk-in picker");
  await firstTrip.click();
  await expect(page).toHaveURL(/tripId=/);
  // The chosen boat is echoed back so the crew can confirm before adding anyone.
  await expect(page.getByText(tripTitle, { exact: false }).first()).toBeVisible();

  // A search for someone who isn't on file falls through to hand-entry.
  const search = page.getByRole("searchbox", { name: "Search by name, email, or phone" });
  await search.fill("Zzyzx No Such Diver");
  await search.press("Enter");
  await expect(page.getByText(/No matches for/)).toBeVisible();

  await page.locator('input[name="fullName"]').fill("Walk-in Test Diver");
  // Email and phone are left blank on purpose — the whole point of this flow.
  await page.getByRole("button", { name: "Add to boat" }).click();

  await expect(page).toHaveURL(/\/check-in\?notice=walkin_added/);
  await expect(page.getByText("Added and on the boat.")).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Walk-in Test Diver" })).toHaveCount(1);
});
