import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterRow,
  openTripFromBoard,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * **The thread between departures** (third UX review, items 11 and 12).
 *
 * A one-seat departure sells its seat and two more divers join its wait list.
 * Staff carry the wait list to a later departure from the demand banner and
 * land on it, where the interests wait to be invited; then staff move the booked
 * seat there from its roster row. The booking is the same row, so the diver's
 * own trip link now reads the new departure.
 */

signedInAsOwner();

async function joinWaitlist(page: Page, tripId: string, name: string) {
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill(name);
  await page
    .getByLabel("Email")
    .fill(`${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Join the wait list" }).click();
  await expect(page.getByRole("heading", { name: /You’re on the wait list/ })).toBeVisible();
}

test("staff carry a full boat's wait list to another departure, then move a seat there", async ({
  page,
}) => {
  // Two departures built, three public visits, and two staff acts: the same
  // aggregate-cost reasoning participant-types.spec.ts states for its flow.
  test.setTimeout(60_000);

  const stamp = e2eNow().getTime();
  const full = `Move From ${stamp}`;
  const later = `Move To ${stamp}`;
  await createTrip(page, {
    title: full,
    date: daysFromNow(4),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 1,
    price: 120,
  });
  await createTrip(page, {
    title: later,
    date: daysFromNow(6),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 6,
    price: 120,
  });
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, full);
  const fromUrl = page.url();
  const fromId = fromUrl.match(/\/trips\/([^/?#]+)/)?.[1];
  if (!fromId) throw new Error("could not read the trip id from the URL");

  await signOut(page);
  await page.goto(`/s/blue-mantis/trips/${fromId}`);
  await bookASeatAndOpenThread(page, "Moira Seat");
  const readyUrl = page.url();
  await joinWaitlist(page, fromId, "Wren Waiting");
  await joinWaitlist(page, fromId, "Iris Waiting");

  await signInAsOwner(page);
  await page.goto(fromUrl);

  // The demand banner's second door: the departure already on the board.
  const carry = page.getByLabel("Or offer them a departure already on the board");
  const laterOption = carry.locator("option", { hasText: later });
  await carry.selectOption((await laterOption.getAttribute("value")) ?? "");
  await page.getByRole("button", { name: "Carry who’s waiting" }).click();
  await page.waitForURL((url) => /\/trips\//.test(url.pathname) && !url.pathname.includes(fromId));
  await expect(page.getByRole("status")).toContainText(
    "2 divers from the wait list are here now. Invite them below.",
  );
  const laterUrl = page.url();
  await expect(page.getByText("Wren Waiting")).toBeVisible();
  await expect(page.getByText("Iris Waiting")).toBeVisible();

  // Then the seat itself, from its row on the full departure.
  await page.goto(fromUrl);
  const row = await openRosterRow(page, "Moira Seat");
  await row.locator("summary", { hasText: "Move to another departure" }).click();
  const departure = row.getByLabel("Departure");
  await departure.selectOption(
    (await departure.locator("option", { hasText: later }).getAttribute("value")) ?? "",
  );
  await row.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/^Moved/);
  await expect(page.locator("#roster").getByRole("link", { name: "Moira Seat" })).toHaveCount(0);

  await page.goto(laterUrl);
  await expect(page.locator("#roster").getByRole("link", { name: "Moira Seat" })).toBeVisible();

  // The diver's own link followed the seat.
  await signOut(page);
  await page.goto(readyUrl);
  await expect(page.getByText(later).first()).toBeVisible();
});
