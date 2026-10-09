import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  openTripMore,
  publicTripUrl,
  seededTripId,
  tripPathByTitle,
} from "./helpers";

const SHOP = "blue-mantis";

/**
 * **One weather call for a whole morning or day** (ADR
 * 20261009-day-weather-call).
 *
 * A front closes the harbour for every boat that morning. The day call lists
 * the day's departures with who is on each, selects all of them or those
 * before noon, shows the call for review, and calls the selected ones through
 * the ordinary single-trip blow-out, in an order that never offers a diver a
 * sister departure the same call cancels.
 */
test.describe("the day's weather call", () => {
  signedInAsOwner();

  test("calls the selected departures and offers nobody a boat it cancels", async ({ page }) => {
    // Two creates, a public booking, the day page, its review and a cascade record.
    test.setTimeout(60_000);
    const stamp = e2eNow().getTime();
    const morning = `Weather morning ${stamp}`;
    const afternoon = `Weather afternoon ${stamp}`;
    const date = daysFromNow(9);
    await createTrip(page, {
      title: morning,
      date,
      departsAt: "08:00",
      returnsAt: "10:00",
      price: 120,
    });
    // Priced and empty: exactly the boat the morning's diver would be offered
    // if the call did not know it was cancelling it too.
    await createTrip(page, {
      title: afternoon,
      date,
      departsAt: "13:00",
      returnsAt: "15:00",
      price: 120,
    });

    const morningPath = await tripPathByTitle(page, SHOP, morning);
    await page.goto(publicTripUrl(morningPath));
    await bookASeatAndOpenThread(page, "Harbour Closed");

    // From the departure's own "More", beside the single-trip blow-out.
    await page.goto(morningPath);
    await openTripMore(page);
    await page.getByRole("link", { name: "Weather blow-out for the whole day…" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Call a blow-out for the day?" }),
    ).toBeVisible();
    const morningBox = page.getByRole("checkbox", { name: new RegExp(morning) });
    const afternoonBox = page.getByRole("checkbox", { name: new RegExp(afternoon) });
    // Nothing is selected until somebody chooses: a call that cancels boats is
    // never the default.
    await expect(morningBox).not.toBeChecked();
    await expect(afternoonBox).not.toBeChecked();
    await expect(page.getByText("1 booked")).toBeVisible();

    // The "before noon" preset leaves the afternoon boat alone…
    await page.getByRole("link", { name: "Before noon" }).click();
    await expect(page).toHaveURL(/pick=morning/);
    await expect(afternoonBox).not.toBeChecked();
    await expect(morningBox).toBeChecked();
    // …and any selection is still the staffer's: just this spec's two boats,
    // leaving alone whatever else the shared demo day holds.
    const boxes = page.getByRole("checkbox");
    await expect(boxes).not.toHaveCount(0);
    for (const box of await boxes.all()) await box.uncheck();
    await morningBox.check();
    await afternoonBox.check();

    // The review says exactly what the call will do, and only its button does it.
    await page.getByRole("button", { name: "Review the call" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Cancel these departures?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel 2 departures, 1 diver" }).click();
    await expect(page.getByRole("status")).toContainText("Blow-out called on 2 departures");

    // Both are called now, and each keeps its own ordinary cascade record.
    await expect(morningBox).toHaveCount(0);
    await expect(afternoonBox).toHaveCount(0);
    const row = (title: string) => page.getByRole("listitem").filter({ hasText: title });
    await expect(row(afternoon)).toContainText("Already called");
    await expect(row(morning)).toContainText("Already called");
    // The record is a link away: "Finish sending" while a message is still
    // unsent (a test server sends no mail), "Open the cascade" once all went.
    await row(morning)
      .getByRole("link", { name: /^(Finish sending|Open the cascade)$/ })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Harbour Closed" })).toBeVisible();
    // The afternoon boat, cancelled by the same call, is offered to nobody.
    const offers = (await page.locator("tbody td:nth-child(4)").allTextContents()).join(" · ");
    expect(offers).not.toContain(afternoon);
  });
});

/**
 * Calling a whole day off is the owner's, a manager's or a captain's call
 * (owner's decision, 2026-10-09). A divemaster still has the single-trip
 * blow-out on every departure, and no door to the day.
 */
test.describe("the day's weather call, for a divemaster", () => {
  signedInAs("divemaster");

  test("offers no door to it on a departure", async ({ page }) => {
    const tripId = await seededTripId(page, SHOP, "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/${SHOP}/trips/${tripId}`);
    const more = await openTripMore(page);
    await expect(more.getByRole("link", { name: "Weather blow-out…" })).toBeVisible();
    await expect(
      more.getByRole("link", { name: "Weather blow-out for the whole day…" }),
    ).toHaveCount(0);
  });

  test("turns the address away with a reason", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/schedule/blowout/day/${daysFromNow(9)}`);
    // Today carries its own status line too; the refusal is the one that says why.
    await expect(
      page.getByRole("status").filter({ hasText: "Calling a whole day off is limited" }),
    ).toContainText("owners, managers and captains");
  });
});
