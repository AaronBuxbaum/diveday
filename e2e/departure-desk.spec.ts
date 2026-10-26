import { LOST_MASK } from "../src/db/seed-booth";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  HELD_SEND_TIMEOUT_MS,
  manifestRow,
  openRosterDetails,
  openTripFromBoard,
  openTripTab,
  seededTripId,
} from "./helpers";

const staff = staffTranslator("en-US");

/**
 * The departure desk (batch 4): somebody added at the dock (D6), a note to
 * everyone on a departure (J4), and what the crew finds aboard after it (J2).
 * Each against the demo's own reef boat, which the frozen clock puts five
 * hours out (2:30 PM against 9:30 AM).
 */

const REEF = "Two-Tank Reef — Molasses & French";
const SAILED = "Dawn Two-Tank — Molasses Reef";

signedInAsOwner();

test("a captain adds a rider at the dock, who counts at once and only once", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, REEF);
  await openTripTab(page, "Manifest");

  await page.locator("#dock-rider summary").click();
  const form = page.getByTestId("dock-rider-form");
  await form.getByLabel("Name").fill("Sam Rider");
  await form.getByLabel("Emergency contact", { exact: true }).fill("Jo Rider");
  await form.getByLabel("Emergency contact phone").fill("+1 305 555 0199");
  await form.getByRole("button", { name: "Add rider" }).click();
  // A seat is not boarding: the demo shop asks for its release, so the notice
  // says the rider still owes it and hands the release over.
  await expect(
    page.getByText(
      "Sam Rider is on the manifest and still needs to sign the release before boarding.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(form.getByRole("link", { name: "open the release on this phone" })).toHaveAttribute(
    "href",
    /^\/waivers\//,
  );
  await expect(manifestRow(page, "Sam Rider")).toBeVisible();

  // The same name again is a second tap, not a second rider.
  const again = page.getByTestId("dock-rider-form");
  await again.getByLabel("Name").fill("sam rider");
  await again.getByLabel("Emergency contact", { exact: true }).fill("Jo Rider");
  await again.getByLabel("Emergency contact phone").fill("+1 305 555 0199");
  await again.getByRole("button", { name: "Add rider" }).click();
  await expect(page.getByText("Someone by that name is already aboard.")).toBeVisible();
});

test("a note to everyone holds, refuses a link, and is recorded once sent", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, REEF);
  await page.goto(`${new URL(page.url()).pathname}?view=details#departure-note`);

  const box = page.getByTestId("departure-note-body");
  await expect(box).toBeVisible();
  const send = page.getByRole("button", { name: "Send to everyone booked" });
  await box.fill("Map at parking.example");
  await expect(page.getByText("Take the link out.", { exact: false })).toBeVisible();
  await expect(send).toBeDisabled();

  await box.fill("Marina lot is closed, park at the Elks lodge.");
  await expect(send).toBeEnabled();
  await page.locator("form[data-hydrated='true']").filter({ has: box }).waitFor();
  await send.click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByText(/^Sent\. \d+ of \d+ delivered\.$/)).toBeVisible({
    timeout: HELD_SEND_TIMEOUT_MS,
  });
  await expect(page.getByTestId("departure-notes")).toContainText(
    "Marina lot is closed, park at the Elks lodge.",
  );
});

test("the crew records something left aboard and the shop hands it back", async ({ page }) => {
  test.setTimeout(45_000);
  // The demo's dawn boat has already sailed, so its Boat tab carries "Left aboard".
  const tripId = await seededTripId(page, "blue-mantis", SAILED);
  await page.goto(`/shop/blue-mantis/trips/${tripId}/manifest`);
  const form = page.getByTestId("lost-item-form");
  await form.getByLabel("What was found").fill("Blue mask, seat 4");
  const seat = form.getByLabel("Whose seat");
  const owner = (await seat.locator("option").nth(1).textContent())?.trim() ?? "";
  expect(owner).not.toBe("");
  await seat.selectOption({ label: owner });
  await form.getByRole("button", { name: "Record" }).click();
  const item = page.getByTestId("lost-item").filter({ hasText: "Blue mask, seat 4" });
  await expect(item).toContainText(owner);
  await expect(item.getByRole("button", { name: `Tell ${owner}` })).toBeVisible();

  // **Today gives Lost and found its door** (fifth loop, item 7): one row
  // while anything waits, counted, opening the list.
  await page.goto("/shop/blue-mantis");
  const waiting = page.getByRole("link", { name: "Open lost and found" });
  await expect(waiting).toHaveAttribute("href", "/shop/blue-mantis/lost-found");
  await expect(page.getByText(/^\d+ things? waiting to go home$/)).toBeVisible();
  await waiting.click();
  await page.waitForURL("**/shop/blue-mantis/lost-found");
  const row = page.getByTestId("lost-item").filter({ hasText: "Blue mask, seat 4" });
  await expect(row).toContainText(SAILED);
  await row.getByRole("button", { name: staff("desk.lostFound.returned"), exact: true }).click();
  // Handed back, it leaves the list; the demo's own left-behind mask (H-148)
  // still waits for its diver, booked tomorrow.
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId("lost-item").filter({ hasText: LOST_MASK })).toBeVisible();
});

/**
 * H-133: a diver the crew marked aboard a boat that has left cannot be taken
 * off the roster. The dawn boat is home with its sailed seats boarded, so a
 * sailed row's Remove says why and offers no confirm; the seat stays.
 */
test("Remove on a diver marked aboard a boat that has left says why and changes nothing", async ({
  page,
}) => {
  const tripId = await seededTripId(page, "blue-mantis", SAILED);
  await page.goto(counterPath("blue-mantis", tripId));
  await page.getByRole("heading", { name: /^Sailed · \d+$/ }).waitFor();
  const remove = /^\s*Remove booking\s*$/;
  const row = page
    .locator('#roster li[id^="booking-"]')
    .filter({ has: page.locator("summary", { hasText: remove }) })
    .first();
  await openRosterDetails(row);
  await row.locator("summary", { hasText: remove }).click();
  // The sentence after the diver's name, from the bundle.
  const why = staff("trips.roster.removeAboard", { name: "" }).trim();
  await expect(row.getByRole("status").filter({ hasText: why })).toBeVisible();
  await expect(row.getByRole("button", { name: "Yes, remove booking" })).toHaveCount(0);
});
