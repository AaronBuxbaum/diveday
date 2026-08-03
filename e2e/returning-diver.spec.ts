import { expect, test } from "./fixtures";
import { acceptAgeAttestation } from "./helpers";

test("a device that just booked prefills the next booking form, with a one-tap way out", async ({
  page,
}) => {
  // Book once as Marco Reyes on one trip.
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Marco Reyes");
  await page.getByLabel("Email").fill("marco@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Marco/ })).toBeVisible();

  // A second, unrelated trip's booking form now prefills the lead diver from
  // this device — no re-typing a name and email it already has.
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByLabel("Name")).toHaveValue("Marco Reyes");
  await expect(page.getByLabel("Email")).toHaveValue("marco@example.com");
  await expect(page.getByText("Booking as", { exact: false })).toBeVisible();

  // "Not you?" clears it for someone else booking on the same device.
  await page.getByRole("button", { name: "Not you?" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await expect(page.getByText("Booking as", { exact: false })).not.toBeVisible();
});

test("the embed widget never prefills or remembers a booker", async ({ page }) => {
  await page.goto("/s/blue-mantis?embed=1");
  await page
    .locator("li")
    .filter({ hasText: "Discover Scuba — Pool & Reef" })
    .getByRole("link", { name: "Discover Scuba — Pool & Reef" })
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Sal Moretti");
  await page.getByLabel("Email").fill("sal@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Sal/ })).toBeVisible();

  const stored = await page.evaluate(() => localStorage.getItem("diveday:returning-diver:v1"));
  expect(stored).toBeNull();
});
