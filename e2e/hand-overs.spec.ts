import { DEMO_COMPLETED_TRIP_TITLE } from "../src/db/seed-more-trips";
import { DEMO_TODAY_TRIP_TITLE } from "../src/db/seed-trips";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  openBoatCheck,
  openTripFromBoard,
  openTripTab,
  seededTripId,
} from "./helpers";

/**
 * **What the boat day hands to the next one** (fifth-loop ideas, items 1, 2,
 * 4 and 6): a crew's snag reaching the boat's next crew, the sailed list
 * becoming the rebooking list, the plan saying what the reef was like last
 * time, and the evening adding tomorrow's boats together.
 */
signedInAsOwner();

test("a snag noted on the boat check reaches that boat's next crew, who mark it fixed", async ({
  page,
}) => {
  // Two departures' manifests, each reached from the board, plus a write on
  // each: measured 15.7s on CI's runner, past the 15s default.
  test.setTimeout(30_000);
  // Today's boat sails on Mantis I; the night dive is that hull's next departure.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
  await openTripTab(page, "Manifest");
  await openBoatCheck(page);
  const radio = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "VHF radio checked" }) });
  // One "Note a problem" for the list, with an item picker (B07).
  await page.getByText("Note a problem").click();
  await page.getByLabel("Which item?").selectOption({ label: "VHF radio checked" });
  await page.getByLabel("What’s wrong?").fill("VHF crackles on 16");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(radio.getByText("VHF crackles on 16")).toBeVisible();

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Night Dive — City of Washington");
  await openTripTab(page, "Manifest");
  const carried = page.getByRole("region", { name: "Open on this boat" });
  await expect(carried.getByText("VHF radio checked: VHF crackles on 16")).toBeVisible();
  await carried.getByRole("button", { name: "Fixed" }).click();
  await expect(page.getByRole("region", { name: "Open on this boat" })).toHaveCount(0);
});

test("the plan says what the reef was like the last time a boat went", async ({ page }) => {
  // The dawn boat dived Molasses Reef this morning; today's later boat plans it.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, DEMO_TODAY_TRIP_TITLE);
  const root = new URL(page.url()).pathname;
  await page.goto(`${root}?view=details`);
  await expect(page.getByText(/Molasses Reef: last dived /).first()).toBeVisible();

  await openTripTab(page, "Manifest");
  const plan = page.getByRole("region", { name: "The plan" });
  await expect(plan.getByText(/Molasses Reef: last dived /)).toBeVisible();
});

test("the boat that is home says each diver's next dive under their name", async ({ page }) => {
  // Off the board, which lists what is still to come: this boat is back.
  const tripId = await seededTripId(page, "blue-mantis", DEMO_COMPLETED_TRIP_TITLE);
  await page.goto(counterPath("blue-mantis", tripId));
  await expect(page.getByRole("heading", { name: /^Sailed · \d+$/ })).toBeVisible();
  await expect(page.getByText(/^(Nothing else booked · |Booked )/).first()).toBeVisible();
});

test("the closing evening adds tomorrow's boats together and prints tomorrow", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  expect((await request.post("/api/test/seed-evening?heads=closed")).ok()).toBe(true);
  await page.goto("/shop/blue-mantis");
  const tomorrow = page.getByRole("region", { name: "Tomorrow from tonight" });
  await expect(tomorrow.getByText(/\d+ tanks? to fill/)).toBeVisible();
  const print = tomorrow.getByRole("link", { name: "Print tomorrow" });
  await expect(print).toHaveAttribute("href", "/shop/blue-mantis/print?day=tomorrow");

  // The printed day for tomorrow: its own title, and the same load-out line.
  await page.goto("/shop/blue-mantis/print?day=tomorrow");
  await expect(page.getByRole("heading", { level: 1, name: "Tomorrow’s packet" })).toBeVisible();
  await expect(page.getByText(/\d+ tanks? to fill/).first()).toBeVisible();
});
