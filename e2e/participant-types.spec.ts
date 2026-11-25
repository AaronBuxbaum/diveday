import type { Locator, Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  guestFact,
  manifestRow,
  openIfClosed,
  openRosterDetails,
  openTripAboutRow,
  openTripFromBoard,
  openTripTab,
  rosterRow,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * **A snorkeler on a diver's boat** (ADR 20261007-participant-types).
 *
 * The flow a shop runs: name a snorkeler price on a departure, a guest books a
 * snorkeler seat from the public page, and the crew sees that person on the
 * roster, the manifest and the roll call with the type in words. The roll call
 * is the reason this spec exists: a body that is aboard and missing from the
 * list the boat leaves with is the failure the whole feature is there to stop,
 * and a snorkeler who was never asked for a card must still be called back.
 */

signedInAsOwner();

/** The seat's own roster card, not every `<li>` the name appears in (the fit list names them too). */
async function seatRow(page: Page, name: string): Promise<Locator> {
  return rosterRow(page, name);
}

test("a snorkeler books from the public page and is on the manifest and the roll call", async ({
  page,
}) => {
  // Five journeys: build a departure, set its terms, book as a guest, sign
  // back in, then read the roster, the manifest and the type change. Same
  // aggregate-cost reasoning minimum-seats.spec.ts states for its own flow.
  test.setTimeout(45_000);

  const title = `Snorkel Morning ${e2eNow().getTime()}`;
  const guest = "Lena Marsh";
  await createTrip(page, {
    title,
    date: daysFromNow(3),
    departsAt: "08:00",
    returnsAt: "12:00",
    capacity: 8,
    price: 120,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const tripUrl = page.url();
  const tripId = tripUrl.match(/\/trips\/([^/?#]+)/)?.[1];
  if (!tripId) throw new Error("could not read the trip id from the URL");

  // The shop names a snorkeler price. Until it does, the public form sells
  // diving only, which is asserted below before the price exists.
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await expect(
    page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Joining as")).toHaveCount(0);

  await page.goto(tripUrl);
  const terms = await openTripAboutRow(page, "Snorkelers and riders");
  await terms.getByLabel("Snorkeler price").fill("45");
  await terms.getByRole("button", { name: "Save" }).click();
  await expect(terms.locator("summary")).toContainText(/Snorkeler \$45/);

  // A guest, signed out, books one snorkeler seat at the snorkeler price.
  await signOut(page);
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  const joiningAs = page.getByLabel("Joining as");
  await expect(joiningAs).toBeVisible();
  await expect(joiningAs.locator("option")).toHaveText([/^Diving/, /^Snorkeling, \$45/]);
  await joiningAs.selectOption("snorkeler");
  await page.getByLabel("Name", { exact: true }).fill(guest);
  await page.getByLabel("Email", { exact: true }).fill(`lena-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  // Staff see who they are on the roster.
  await signInAsOwner(page);
  await page.goto(tripUrl);
  await openTripTab(page, "Trip");
  const row = await seatRow(page, guest);
  // The chip beside the name; the opened guest's "Coming as" row says it again.
  await expect(row.getByText("Snorkeler", { exact: true }).first()).toBeVisible();

  // And on the manifest: in the head count's split, and on the roll-call row
  // the crew calls back after the dive.
  await openTripTab(page, "Manifest");
  await expect(page.locator('[data-deck-screen="home"]')).toBeVisible();
  const called = await manifestRow(page, guest);
  await expect(called).toBeVisible();
  await expect(called.getByText("Snorkeler", { exact: true })).toBeVisible();

  // The desk changes their mind for them: they are staying on the boat. The
  // row says so, and the roll call still lists them.
  await openTripTab(page, "Trip");
  const seat = await seatRow(page, guest);
  await openRosterDetails(seat);
  await openIfClosed(guestFact(seat, "Coming as"));
  await seat.getByLabel("Coming as").selectOption("rider");
  await seat.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/notice=participant-type-set/);
  await expect(
    (await seatRow(page, guest)).getByText("Rider", { exact: true }).first(),
  ).toBeVisible();

  await openTripTab(page, "Manifest");
  await expect((await manifestRow(page, guest)).getByText("Rider", { exact: true })).toBeVisible();
});
