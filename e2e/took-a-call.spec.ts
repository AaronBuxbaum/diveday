import type { Locator, Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

/**
 * **"Took a call"** (N-22): the desk phone's answer for a caller with no seat
 * to book, kept at the foot of Add a booking as a disclosure (`#call`) titled
 * "Full boat or another day?".
 *
 * What this pins is the *routing*, because that is the whole feature. Each of
 * the two answers is written by a door that already exists and already has its
 * own spec — a date request by `date-requests.spec.ts`, a wait-list entry by
 * the trip page's own writer — so what could break here is a call arriving at
 * the wrong one of them, or a caller's answers being dropped on the way.
 */
const ADD_BOOKING = "/shop/blue-mantis/bookings/new";

/**
 * Open Add a booking with the call form showing. The `#call` hash opens the
 * disclosure on arrival; the form is scoped to it so the page's own booking
 * controls above can never answer a label meant for the call.
 */
async function openCallForm(page: Page): Promise<Locator> {
  await page.goto(`${ADD_BOOKING}#call`);
  const call = page.locator("details#call");
  await expect(call.getByRole("heading", { name: "Full boat or another day?" })).toBeVisible();
  await expect(call).toHaveJSProperty("open", true);
  return call;
}

/**
 * A departure with no seat left, made for this test: the call form offers
 * only full boats for the wait list, and which seeded boats are full is the
 * seed's business. One seat, filled by one diver from the trip's own roster.
 */
async function fullDeparture(page: Page): Promise<string> {
  const title = `Call Full Trip ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(1),
    departsAt: "09:00",
    returnsAt: "11:00",
    capacity: 1,
  });
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  // Tomorrow's boat is inside the arrivals window, where "Add a diver" is one
  // search field and a booked seat is its empty result's "Add diver".
  const find = page.getByRole("searchbox", { name: "Find a returning diver" });
  await find.fill("Fills The Boat");
  await find.press("Enter");
  await page.getByRole("link", { name: "Add diver", exact: true }).first().click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Fills The Boat");
  await page.getByLabel("Email").fill(`call-fills-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
  await expect(page.getByRole("status")).toContainText("Diver added to the trip");
  return title;
}

async function chooseDeparture(call: Locator, title: string) {
  const select = call.getByLabel("Which departure");
  const option = select.locator("option").filter({ hasText: title });
  const value = await option.getAttribute("value");
  expect(value, `the call form offers no full departure named ${title}`).toBeTruthy();
  await select.selectOption(value as string);
}

test.describe("took a call", () => {
  signedInAsOwner();

  test("a caller asking for a day off the board lands with the date requests", async ({ page }) => {
    const call = await openCallForm(page);
    await call.getByLabel("Full name").fill("Marisol Cabrera E2E");
    await call.getByLabel("Phone").fill("+1 305 555 0184");
    await call.getByLabel("A day that isn’t on the board").check();
    await call.getByLabel("What they asked about").fill("A night dive over the holidays");
    await call.getByLabel("How many divers").fill("3");
    await call.getByRole("button", { name: "Log the call" }).click();

    // Lands where the lead now lives, saying so once.
    await page.waitForURL(/\/shop\/blue-mantis\/requests\?notice=call-logged/);
    await expect(page.getByText("Call logged.")).toBeVisible();
    await expect(page.getByText("Wants to dive: A night dive over the holidays")).toBeVisible();
    await expect(page.getByText("Marisol Cabrera E2E")).toBeVisible();
  });

  /**
   * The wait list is only for a boat with no seat left, so the form offers
   * only those — and the join is the trip page's own writer, which is what
   * keeps one answer to "is this boat full" in the app.
   */
  test("a caller wanting a full boat is wait-listed by the trip page's own writer", async ({
    page,
  }) => {
    const title = await fullDeparture(page);
    const call = await openCallForm(page);
    await call.getByLabel("Full name").fill("Tobias Fenn E2E");
    await call.getByLabel("Email").fill("tobias.fenn.e2e@example.com");
    await call.getByLabel("A seat on a full departure").check();
    await chooseDeparture(call, title);
    await call.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}\?notice=diver-waitlisted/);
    await expect(page.getByText("Diver added to the wait list.")).toBeVisible();
    await expect(page.getByText("Tobias Fenn E2E").first()).toBeVisible();
  });

  test("a caller nobody can ring back is refused beside the button, with the answer kept", async ({
    page,
  }) => {
    const call = await openCallForm(page);
    await call.getByLabel("Full name").fill("Nobody Reachable E2E");
    await call.getByLabel("A day that isn’t on the board").check();
    await call.getByLabel("What they asked about").fill("Anything in June");
    await call.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(/\/bookings\/new\?.*notice=call-reply/);
    // The refusal reopens the disclosure on its own: a shut one would hide the
    // answer the staffer is waiting for.
    const refused = page.locator("details#call");
    await expect(refused).toHaveJSProperty("open", true);
    await expect(
      refused.getByText("Take an email or a phone number, or nobody can ring them back."),
    ).toBeVisible();
    // The branch the staffer chose survives the refusal: they are not asked to
    // re-read the options with somebody on the line.
    await expect(refused.getByLabel("What they asked about")).toBeVisible();
  });

  /**
   * A wait-list entry with no address has nobody to invite when a seat frees,
   * and this is the one refusal that differs by outcome — the same caller would
   * have been a perfectly good date request.
   */
  test("a wait-list call with only a phone number is refused for the address", async ({ page }) => {
    const title = await fullDeparture(page);
    const call = await openCallForm(page);
    await call.getByLabel("Full name").fill("Phone Only E2E");
    await call.getByLabel("Phone").fill("+1 305 555 0199");
    await call.getByLabel("A seat on a full departure").check();
    await chooseDeparture(call, title);
    await call.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(/\/bookings\/new\?.*notice=call-email/);
    await expect(
      page.locator("details#call").getByText(/A wait-list entry needs an email address/),
    ).toBeVisible();
  });
});
