import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signInAsOwner } from "./helpers";

/**
 * Refunds are staff-run (docs H-07): cancelling a paid booking never moves
 * money by itself unless the trip states a cancellation window and the
 * payment was captured through Stripe. These specs exercise the two
 * non-Stripe outcomes a shop hits constantly — a counter/cash payment marked
 * paid by hand, and a cancellation past the stated deadline — without
 * depending on a live Stripe connection.
 */
test.describe("refunds", () => {
  signedInAsOwner();

  async function createPaymentRequiredTrip(
    page: import("@playwright/test").Page,
    options: { title: string; date: string; cancellationWindowHours: number },
  ) {
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(options.title);
    await page.getByLabel("Date").fill(options.date);
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:30");
    await page.getByLabel("Capacity").fill("6");
    await page.getByLabel(/Price per diver/).fill("120");
    await page.getByLabel("Free cancellation window").fill(String(options.cancellationWindowHours));
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    // Open the trip and turn on "requires payment" so the roster shows a
    // payment control at all (off by default — most trips never charge).
    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: options.title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: options.title })).toBeVisible();
    await page.getByLabel("Require payment to board").check();
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByRole("status")).toContainText("requirements updated");
  }

  async function bookAndMarkPaid(
    page: import("@playwright/test").Page,
    title: string,
    // Distinguishes this helper's two call sites' divers: both tests reuse
    // "Nora Quinn", and the frozen clock (unlike Date.now()) no longer makes
    // their emails unique on its own.
    emailTag: string,
  ) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/shop/blue-mantis/schedule", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await page.getByLabel("Name").fill("Nora Quinn");
    await page.getByLabel("Email").fill(`nora-${emailTag}-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();

    const noraRow = page.locator("li").filter({ hasText: "Nora Quinn" });
    await noraRow.getByRole("combobox").selectOption("paid");
    await noraRow.getByRole("button", { name: "Update" }).click();
    await expect(page.getByRole("status")).toContainText("Payment status updated");
    await expect(noraRow.getByText("Payment: Paid")).toBeVisible();
    return noraRow;
  }

  test("cancelling a paid counter booking inside the free-cancellation window flags a manual refund", async ({
    page,
  }) => {
    const title = `Refund Window Trip ${e2eNow().getTime()}`;
    await createPaymentRequiredTrip(page, {
      title,
      date: daysFromNow(5),
      cancellationWindowHours: 24,
    });
    const noraRow = await bookAndMarkPaid(page, title, "refund");

    page.once("dialog", (dialog) => void dialog.accept());
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "a refund is owed but must be issued by hand" }),
    ).toBeVisible();
    await expect(page.getByText("Nora Quinn")).toHaveCount(0);
  });

  test("cancelling a paid booking past the cancellation deadline forfeits the refund", async ({
    page,
  }) => {
    const title = `Forfeit Window Trip ${e2eNow().getTime()}`;
    // A window far longer than the time left before departure puts the
    // deadline in the past the instant the trip is created.
    await createPaymentRequiredTrip(page, {
      title,
      date: daysFromNow(1),
      cancellationWindowHours: 720,
    });
    const noraRow = await bookAndMarkPaid(page, title, "forfeit");

    page.once("dialog", (dialog) => void dialog.accept());
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    // The cancellation itself still succeeded (the seat is freed either way),
    // so this notice is informational (status), unlike the manual-refund case
    // above where staff still owe the diver money (alert).
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "past the cancellation window, so the seat was non-refundable" }),
    ).toBeVisible();
    await expect(page.getByText("Nora Quinn")).toHaveCount(0);
  });
});
