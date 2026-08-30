import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openTripActivity,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * A **diver-initiated** cancel refunds itself only inside a stated window and
 * only for a Stripe capture (docs H-07); everything else is staff-run. These
 * specs exercise the two non-Stripe outcomes a shop hits constantly — a
 * counter/cash payment marked paid by hand, and a cancellation past the stated
 * deadline — without depending on a live Stripe connection.
 *
 * A **shop-initiated** cancel is the other rule and is not exercised here: a
 * weather blow-out or the minimum-head-count sweep refunds unconditionally,
 * window or no window (ADR 20260813-shop-cancellation-refunds-itself). That
 * arm needs a connected account to show anything, so it is covered in
 * src/db/refunds.test.ts, where the Stripe seam is injectable — including the
 * case this file's second test asserts the opposite of: past the deadline, the
 * shop-cancelled arm still refunds.
 */
test.describe("refunds", () => {
  signedInAsOwner();

  async function createPaymentRequiredTrip(
    page: Page,
    options: { title: string; date: string; cancellationWindowHours: number },
  ) {
    await createTrip(page, {
      title: options.title,
      date: options.date,
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
      price: 120,
      cancellationWindowHours: options.cancellationWindowHours,
    });

    // Open the trip and turn on "requires payment" so the roster shows a
    // payment control at all (off by default — most trips never charge).
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: options.title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: options.title })).toBeVisible();
    // The requirements form waits behind its Edit disclosure (summary-first
    // Overview).
    await page.getByText("Edit requirements", { exact: true }).click();
    await page.getByLabel("Require payment to board").check();
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByRole("status")).toContainText("requirements updated");
  }

  async function bookAndMarkPaid(
    page: Page,
    title: string,
    // Distinguishes this helper's two call sites' divers: both tests reuse
    // "Nora Quinn", and the frozen clock (unlike Date.now()) no longer makes
    // their emails unique on its own.
    emailTag: string,
  ) {
    await signOut(page);

    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    // Scoped to the trip list itself, the page's one stable anchor for
    // departures — day rules and other lists on the page never carry a
    // trip's title.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name").fill("Nora Quinn");
    await page.getByLabel("Email").fill(`nora-${emailTag}-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    const noraRow = page.locator("li").filter({ hasText: "Nora Quinn" }).filter({ visible: true });
    await noraRow.getByRole("combobox").selectOption("paid");
    await noraRow.getByRole("button", { name: "Update" }).click();
    await expect(page.getByRole("status")).toContainText("Payment status updated");
    await expect(noraRow.getByText("Payment: Paid")).toBeVisible();
    return noraRow;
  }

  test("cancelling a paid counter booking inside the free-cancellation window flags a manual refund", async ({
    page,
  }) => {
    // `createPaymentRequiredTrip` + `bookAndMarkPaid` alone chain several full
    // page navigations and status-toast waits before this test's own body
    // even starts. A traced CI failure measured the total sequential cost at
    // 18.2s against the default 15s test timeout — every individual step
    // resolved successfully (none were stuck), the outer clock just ran out
    // first. Same reasoning as visual.spec.ts's `test.setTimeout` on its
    // heaviest capture sequence: aggregate per-step cost across many
    // sequential steps in one test, not a hang this override would mask.
    test.setTimeout(30_000);
    const title = `Refund Window Trip ${e2eNow().getTime()}`;
    await createPaymentRequiredTrip(page, {
      title,
      date: daysFromNow(5),
      cancellationWindowHours: 24,
    });
    const noraRow = await bookAndMarkPaid(page, title, "refund");

    // Two-tap InlineConfirm, not a native dialog: the first tap only arms it.
    await openRosterDetails(noraRow);
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    await noraRow.getByRole("button", { name: "Yes, remove booking" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "a refund is owed but must be issued by hand" }),
    ).toBeVisible();
    // Scoped to the roster: removals now also write the trip activity trail
    // ("… removed Nora Quinn from the trip"), so the name legitimately stays
    // on the page — what must be gone is her seat.
    await expect(page.locator("#roster").getByText("Nora Quinn")).toHaveCount(0);
    await openTripActivity(page);
    await expect(page.getByText(/removed Nora Quinn from the trip/)).toBeVisible();
  });

  test("cancelling a paid booking past the cancellation deadline forfeits the refund", async ({
    page,
  }) => {
    // Same aggregate-cost reasoning as the free-cancellation-window test
    // above — this test chains the same `createPaymentRequiredTrip` +
    // `bookAndMarkPaid` setup.
    test.setTimeout(30_000);
    const title = `Forfeit Window Trip ${e2eNow().getTime()}`;
    // A window far longer than the time left before departure puts the
    // deadline in the past the instant the trip is created.
    await createPaymentRequiredTrip(page, {
      title,
      date: daysFromNow(1),
      cancellationWindowHours: 720,
    });
    const noraRow = await bookAndMarkPaid(page, title, "forfeit");

    // Two-tap InlineConfirm, not a native dialog: the first tap only arms it.
    await openRosterDetails(noraRow);
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    await noraRow.getByRole("button", { name: "Yes, remove booking" }).click();
    // The cancellation itself still succeeded (the seat is freed either way),
    // so this notice is informational (status), unlike the manual-refund case
    // above where staff still owe the diver money (alert).
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "past the cancellation window, so the seat was non-refundable" }),
    ).toBeVisible();
    // Same roster scoping as above: the activity trail now names the removed
    // diver on purpose.
    await expect(page.locator("#roster").getByText("Nora Quinn")).toHaveCount(0);
    await openTripActivity(page);
    await expect(page.getByText(/removed Nora Quinn from the trip/)).toBeVisible();
  });
});
