import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("staff reuses a dive-site briefing on a trip that divers can explore", async ({ page }) => {
  const siteName = `Turtle Garden ${Date.now()}`;
  const tripTitle = `Turtle Garden charter ${Date.now()}`;

  await signInAsOwner(page);
  // "Dive sites" now lives in the nav's "More" group; navigate directly.
  await page.goto("/shop/blue-mantis/dive-sites");
  await page.getByRole("link", { name: "Create a site" }).click();
  await page.getByLabel("Name").fill(siteName);
  await page.getByLabel("Location").fill("Key Largo");
  await page.getByLabel("Latitude").fill("25.123");
  await page.getByLabel("Longitude").fill("-80.321");
  await page.getByLabel("What might divers see?").fill("Green turtles · spotted eagle rays");
  await page
    .getByLabel("Underwater briefing")
    .fill("Look along the sandy edge for turtles resting below the coral heads.");
  await page.getByRole("button", { name: "Save site briefing" }).click();
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

  await page.getByRole("button", { name: "Copy and tailor" }).click();
  await expect(page.getByText("Independent copy ready to tailor.")).toBeVisible();
  await expect(page.getByRole("heading", { name: `${siteName} copy` })).toBeVisible();
  await expect(page.getByLabel("Latitude")).toHaveValue("25.123");
  await expect(page.getByLabel("Longitude")).toHaveValue("-80.321");

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(tripTitle);
  await page.getByLabel("Site briefing").first().selectOption({ label: siteName });
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled
  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: tripTitle }).getByRole("link").click();
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);
  const manageTripUrl = page.url();

  await page.getByLabel("Conditions overview").fill("Warm water and an easy morning are expected.");
  await page.getByLabel("Water temp °C").fill("27");
  await page.getByLabel("Visibility metres").fill("18");
  await page.getByRole("button", { name: "Publish crew prediction" }).click();
  await expect(page.getByRole("status")).toContainText("conditions briefing updated");

  // Staff are routed to the trip editor; view the public diver briefing signed
  // out, then sign back in to finish the staff-side edits below.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: tripTitle }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
  await expect(page.getByText("Green turtles · spotted eagle rays")).toBeVisible();
  await expect(page.getByText("27°C")).toBeVisible();
  await expect(page.getByText("18 m")).toBeVisible();
  await expect(page.getByText("Crew prediction")).toBeVisible();

  await signInAsOwner(page);
  await page.goto(manageTripUrl);
  await page.getByRole("button", { name: "Return to automated outlook" }).click();
  await expect(page.getByRole("status")).toContainText("Crew prediction cleared");
  await expect(page.getByLabel("Water temp °C")).toHaveValue("");
  await expect(page.getByLabel("Visibility metres")).toHaveValue("");
});

test("the seeded reef briefing shows a satellite map, a gentle route, landmarks, and a field guide", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);

  // Staff are routed to the trip editor; view as a diver so the public briefing
  // (satellite map, field guide) renders.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();

  await expect(page.getByTitle("Satellite map of Molasses Reef")).toBeVisible();
  await expect(page.getByText("Reef garden loop")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open map ↗" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Landmarks that tell the story" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Molasses Reef Light" })).toBeVisible();
  await expect(page.getByText("11 likely sightings")).toBeVisible();
  await expect(page.getByRole("img", { name: "Stoplight parrotfish" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Finger sponge" })).toHaveAttribute(
    "src",
    /\/dive-sites\//,
  );
  await expect(page.getByRole("img", { name: /southern stingray/i })).toHaveAttribute(
    "src",
    /Dasyatis%20americana%20NOAA\.jpg/,
  );
});
