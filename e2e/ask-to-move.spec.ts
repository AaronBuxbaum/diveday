import { diverTranslator } from "../src/i18n/messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openTripAbout,
  openTripAboutRow,
  signInAsOwner,
  signOut,
} from "./helpers";

const diver = diverTranslator("en-US");

/**
 * **Ask to move** (H-20261014-ask-to-move). Past the free-cancellation window the diver's own
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
    await openTripAboutRow(page, "Who can book");
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
    await expect(page.getByRole("link", { name: diver("ready.moveAsk.changePlans") })).toHaveCount(
      0,
    );

    await signInAsOwner(page);
    await page.goto(tripUrl);
    const row = page.locator("li").filter({ hasText: "Rafa Ortiz" }).filter({ visible: true });
    await openRosterDetails(row);
    await row.getByRole("combobox").selectOption("paid");
    // The Paid mark asks how the money came in (batch 6 item 1, H-20261014-paid-mark-amount-and).
    await row.getByRole("radio", { name: "Cash" }).check();
    const paymentPath = new URL(tripUrl).pathname;
    const paymentStarted = Promise.withResolvers<void>();
    const releasePayment = Promise.withResolvers<void>();
    const matchesPaymentPath = (url: URL) => url.pathname === paymentPath;
    let pendingPayment: Promise<void> | undefined;
    await page.route(matchesPaymentPath, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        pendingPayment = releasePayment.promise.then(() => route.continue());
        paymentStarted.resolve();
        await pendingPayment;
        return;
      }
      await route.continue();
    });
    try {
      await row.getByRole("button", { name: "Update" }).click();
      await paymentStarted.promise;
      // The real request is still held: this label is optimistic, not a receipt.
      await expect(row.getByText("Payment: Paid")).toBeVisible();
      const paymentSaved = page.waitForURL(
        (url) => url.pathname === paymentPath && url.searchParams.get("notice") === "payment",
      );
      releasePayment.resolve();
      await paymentSaved;
    } finally {
      releasePayment.resolve();
      try {
        await pendingPayment;
      } finally {
        await page.unroute(matchesPaymentPath);
      }
    }

    await page.goto(readyUrl);
    await page.getByRole("link", { name: diver("ready.moveAsk.changePlans") }).click();
    await expect(page.locator("#move-ask")).toBeFocused();
    await expect(page.getByText(/Can’t make this date\? Ask .+ to move you/)).toBeVisible();
    await page.getByLabel("Dates that would work (optional)").fill("Any Saturday in August");
    await page.getByRole("button", { name: "Ask to move" }).click();
    await expect(page.getByText(diver("ready.moveAsk.sent"))).toBeVisible();
    const receipt = page.locator("#move-ask");
    await expect(
      receipt.getByText(diver("ready.moveAsk.asked", { shop: "Blue Mantis Divers" })),
    ).toBeVisible();
    await expect(receipt.getByText("Any Saturday in August", { exact: true })).toBeVisible();
    await expect(receipt.getByText(diver("ready.moveAsk.bookingUnchanged"))).toBeVisible();
    await expect(receipt.locator("time")).toHaveAttribute("datetime", e2eNow().toISOString());
    await page.getByRole("link", { name: diver("ready.moveAsk.requestPending") }).click();
    await expect(receipt).toBeFocused();
    const sentAt = await receipt.locator("time").getAttribute("datetime");
    await page.reload();
    await expect(receipt.getByText("Any Saturday in August", { exact: true })).toBeVisible();
    await expect(receipt.locator("time")).toHaveAttribute("datetime", sentAt ?? "");
    await expect(page.getByRole("button", { name: "Ask to move" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: diver("ready.moveAsk.changePlans") })).toHaveCount(
      0,
    );
    // The cancel is still the diver's own, beneath it.
    await expect(page.getByRole("button", { name: "Cancel my seat" })).toBeVisible();

    await page.goto("/shop/blue-mantis/inbox");
    const ask = page.locator("li").filter({ hasText: "Rafa Ortiz" });
    await expect(ask.getByText("Booking page")).toBeVisible();
    await expect(ask.getByText(/Asked to move/)).toBeVisible();
    await expect(ask.getByText(new RegExp(`Booked on ${title}`))).toBeVisible();
    await expect(ask.getByText("Any Saturday in August")).toBeVisible();
    await ask.getByRole("button", { name: "More for the message from Rafa Ortiz" }).click();
    await page.getByRole("button", { name: "Mark done", exact: true }).click();
    // The returned row moves groups and remounts its menu. Wait for that
    // committed state before opening it, or the old menu closes the new one.
    const doneAsk = page
      .getByRole("heading", { name: "Done", exact: true })
      .locator("..")
      .getByRole("listitem")
      .filter({ hasText: "Rafa Ortiz" });
    await expect(doneAsk).toBeVisible();
    await doneAsk.getByRole("button", { name: "More for the message from Rafa Ortiz" }).click();
    await expect(
      page.getByRole("button", { name: "Move back to waiting", exact: true }),
    ).toBeVisible();
    await page.goto(readyUrl);
    await expect(page.getByRole("button", { name: diver("ready.moveAsk.action") })).toBeVisible();
    await expect(page.locator("#move-ask time")).toHaveCount(0);
  });
});
