import { diverTranslator } from "../src/i18n/messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openTripAbout,
  signInAsOwner,
  signOut,
} from "./helpers";

const diver = diverTranslator("en-US");

/**
 * **Ask to move** (H-126). Past the free-cancellation window the diver's own
 * page used to offer one button, the cancel that forfeits what they paid. It
 * now offers a request first: the diver asks, the page says it was asked, and
 * the ask lands in the shop's Inbox against the seat. Nothing moves; staff
 * decide.
 */
test.describe("ask to move", () => {
  signedInAsOwner();

  test("a paid diver past the window asks to move, and the shop's Inbox has it", async ({
    page,
  }) => {
    // A trip built, a public booking, a payment marked by hand and the Inbox
    // read: the same aggregate cost refunds.spec.ts names for its override.
    test.setTimeout(45_000);
    const title = `Ask To Move Trip ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(5),
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
      price: 120,
      // Thirty days: five days out is long past it.
      cancellationWindowHours: 720,
    });
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await openTripAbout(page);
    await page.getByText("Edit requirements", { exact: true }).click();
    await page.getByLabel("Require payment to board").check();
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByRole("status")).toContainText("requirements updated");
    const tripUrl = page.url();

    await signOut(page);
    await page.goto(`/s/blue-mantis/trips/${tripUrl.split("/trips/")[1]?.split(/[/?#]/)[0]}`);
    await bookASeatAndOpenThread(page, "Rafa Ortiz");
    const readyUrl = page.url().split("?")[0] ?? "";

    // Unpaid, a cancel costs nothing: there is nothing to ask instead.
    await expect(page.getByRole("button", { name: "Ask to move" })).toHaveCount(0);

    await signInAsOwner(page);
    await page.goto(tripUrl);
    const row = page.locator("li").filter({ hasText: "Rafa Ortiz" }).filter({ visible: true });
    await openRosterDetails(row);
    await row.getByRole("combobox").selectOption("paid");
    // The Paid mark asks how the money came in (batch 6 item 1, H-119).
    await row.getByRole("radio", { name: "Cash" }).check();
    await row.getByRole("button", { name: "Update" }).click();
    await expect(row.getByText("Payment: Paid")).toBeVisible();

    await page.goto(readyUrl);
    await expect(page.getByText(/Can’t make this date\? Ask .+ to move you/)).toBeVisible();
    await page.getByLabel("Dates that would work (optional)").fill("Any Saturday in August");
    await page.getByRole("button", { name: "Ask to move" }).click();
    await expect(page.getByText(diver("ready.moveAsk.sent"))).toBeVisible();
    await expect(page.getByText(/You asked .+ to move you/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask to move" })).toHaveCount(0);
    // The cancel is still the diver's own, beneath it.
    await expect(page.getByRole("button", { name: "Cancel my seat" })).toBeVisible();

    await page.goto("/shop/blue-mantis/inbox");
    const ask = page.locator("li").filter({ hasText: "Rafa Ortiz" });
    await expect(ask.getByText("Booking page")).toBeVisible();
    await expect(ask.getByText(/Asked to move/)).toBeVisible();
    await expect(ask.getByText(new RegExp(`Booked on ${title}`))).toBeVisible();
    await expect(ask.getByText("Any Saturday in August")).toBeVisible();
  });
});
