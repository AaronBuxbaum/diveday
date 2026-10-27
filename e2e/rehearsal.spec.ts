import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

/**
 * **A rehearsal for training day** (ADR 20261012-rehearsal-departures): added
 * from the schedule builder with one box ticked, flagged above its trip page so
 * nobody mistakes it for the real boat, and nowhere a diver can reach it.
 * What it never sends, charges or counts is walked in
 * `src/db/rehearsal-coverage.test.ts`; this is the flow a staffer runs.
 */

signedInAsOwner();

const SHOP = "blue-mantis";

test("staff add a rehearsal from the builder, and its trip page says so", async ({ page }) => {
  const title = `Training Drill ${e2eNow().getTime()}`;
  await page.goto(`/shop/${SHOP}/schedule/board/new?add=full`);
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(2));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:00");
  await page.getByLabel("Seats").fill("6");
  await page.getByLabel("Rehearsal for training day").check();
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

  await page.getByRole("link", { name: title, exact: true }).first().click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}/);
  const banner = page.getByRole("region", { name: "Practice departure for training day" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Nothing about it is sent, charged, shown publicly");

  // Nowhere a diver can reach: not the public schedule, not its own URL.
  const tripId = new URL(page.url()).pathname.split("/")[4];
  await page.goto(`/s/${SHOP}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
  const publicPage = await page.goto(`/s/${SHOP}/trips/${tripId}`);
  expect(publicPage?.status()).toBe(404);
});

test("an ordinary departure carries no rehearsal flag", async ({ page }) => {
  await page.goto(`/shop/${SHOP}/schedule/board`);
  await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
  await page.locator("[data-week-board] a[data-departure-door]").first().click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}/);
  await expect(page.getByRole("navigation", { name: "Departure" })).toBeVisible();
  await expect(page.locator("[data-rehearsal-banner]")).toHaveCount(0);
});
