import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  choosePartySize,
  daysFromNow,
  e2eNow,
  openTripFromBoard,
  publicTripUrl,
} from "./helpers";

signedInAsOwner();

/**
 * **The thread between departures** (fourth UX review, items 31, 34 and 35).
 * A weekly run says it runs and when it sails next; once one date fills, the
 * full page offers the run's next date first, a party of two waits as one
 * lead, and the desk sees the party's size and the door that carries the wait
 * list to another date.
 */
test("a full date in a weekly run points at the next one, and a party waits whole", async ({
  page,
}) => {
  // Schedules a run, two public bookings, a wait-list join and the roster: the
  // aggregate sequential-navigation cost, as in trip-series.spec.ts.
  test.setTimeout(45_000);
  const title = `Run Party ${e2eNow().getTime()}`;
  await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Seats").fill("2");
  await page.getByLabel("How often").selectOption("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const staffUrl = page.url().split(/[?#]/)[0] ?? page.url();
  const publicUrl = publicTripUrl(staffUrl);

  // Item 35: the departure's header says it is one of a run.
  await page.goto(publicUrl);
  await expect(page.getByText(/^Runs every \w+day · next /)).toBeVisible();

  // Fill it: two divers, one seat each.
  await bookASeatAndOpenThread(page, "Rhea Lind");
  await page.goto(publicUrl);
  await bookASeatAndOpenThread(page, "Tomas Berg");

  // Item 31: the full page offers the run's next date first.
  await page.goto(publicUrl);
  await expect(page.getByRole("heading", { name: "This boat’s full" })).toBeVisible();
  // The alternative is the run's own next date, linked by its title.
  const nextDate = page.getByRole("listitem").filter({ hasText: /Next date with room, / });
  await expect(nextDate.getByRole("link", { name: title })).toBeVisible();

  // Item 34: a party of two joins as one lead, asking for two seats.
  await choosePartySize(page, 2);
  await page.getByLabel("Name").fill("Ines Moreau");
  await page.getByLabel("Email").fill(`party-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Join the wait list" }).click();
  await expect(page.getByRole("heading", { name: /You’re on the wait list, Ines/ })).toBeVisible();

  await page.goto(staffUrl);
  await expect(page.getByRole("heading", { name: /Who wants in/ })).toBeVisible();
  await expect(page.getByText("Party of 2")).toBeVisible();
  // The full boat's wait list can be carried to another date of the run.
  await expect(page.getByRole("button", { name: "Carry who’s waiting" })).toBeVisible();
});
