import { expect, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openTripFromBoard,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * "Can't find your link?" (issue #723) — the public re-send door for a diver
 * whose confirmation email never arrived. The whole feature is one security
 * property: the confirmation must read identically whether or not the typed
 * address has a booking here. That is what these two tests exist to pin —
 * not "an email went out", which the e2e fleet has no provider to observe
 * (every other resend spec in this suite stops at the same boundary).
 */

test("a diver with a booking sees the same confirmation as one who has none", async ({ page }) => {
  test.setTimeout(30_000);
  const email = `nora-fmb-${e2eNow().getTime()}@example.com`;
  const title = `Find My Booking Test Trip ${e2eNow().getTime()}`;

  await signInAsOwner(page);
  await createTrip(page, { title, date: daysFromNow(3), departsAt: "09:00", returnsAt: "11:00" });
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Nora Quinn");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
  await signOut(page);

  await page.goto("/s/blue-mantis");
  const findMyBooking = page.locator("#find-my-booking");
  await findMyBooking.getByText("Can't find your link?").click();
  await findMyBooking.getByLabel("Email").fill(email);
  await findMyBooking.getByRole("button", { name: "Send my link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const matchedBody = await page
    .getByText("If that email has a current booking with us, we've sent a fresh link to it.")
    .textContent();

  await page.goto("/s/blue-mantis");
  const secondAttempt = page.locator("#find-my-booking");
  await secondAttempt.getByText("Can't find your link?").click();
  await secondAttempt.getByLabel("Email").fill(`nobody-fmb-${e2eNow().getTime()}@example.com`);
  await secondAttempt.getByRole("button", { name: "Send my link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const unmatchedBody = await page
    .getByText("If that email has a current booking with us, we've sent a fresh link to it.")
    .textContent();

  expect(unmatchedBody).toBe(matchedBody);
});

test("the form is collapsed by default and asks for nothing but an email", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const findMyBooking = page.locator("#find-my-booking");
  await expect(findMyBooking.getByLabel("Email")).toBeHidden();
  await findMyBooking.getByText("Can't find your link?").click();
  await expect(findMyBooking.getByLabel("Email")).toBeVisible();
  await expect(findMyBooking.getByRole("button", { name: "Send my link" })).toBeVisible();
});
