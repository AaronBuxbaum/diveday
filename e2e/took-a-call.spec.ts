import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **"Took a call"** (N-22): the desk phone's one door, and the three places a
 * call lands.
 *
 * What this pins is the *routing*, because that is the whole feature. Each of
 * the three answers is written by a door that already exists and already has
 * its own spec — a date request by `date-requests.spec.ts`, a seating by
 * `add-diver.spec.ts` — so what could break here is a call arriving at the
 * wrong one of them, or a caller's answers being dropped on the way.
 */
const CALLS = "/shop/blue-mantis/calls";

/**
 * The first departure with a seat left, whatever the fixture's day holds.
 *
 * By the option's own seat count rather than by title: which of the seeded
 * boats is still ahead of the frozen clock is the seed's business, and a spec
 * that named one would fail the day the fixture's morning moved. It has to be
 * an *open* one for both of the departure-shaped tests below — the booking
 * because a full boat is refused, and the wait list because refusing a
 * wait-list join on a boat that still has a seat is the exact behaviour being
 * pinned.
 */
async function chooseOpenDeparture(page: Page) {
  const select = page.getByLabel("Which departure");
  const open = select.locator("option").filter({ hasText: /seat(s)? left/ }).first();
  const value = await open.getAttribute("value");
  expect(value, "the fixture's board holds no departure with a seat left").toBeTruthy();
  await select.selectOption(value as string);
}

test.describe("took a call", () => {
  signedInAsOwner();

  test("a caller asking for a day off the board lands with the date requests", async ({ page }) => {
    await page.goto(CALLS);
    await page.getByLabel("Full name").fill("Marisol Cabrera E2E");
    await page.getByLabel("Phone").fill("+1 305 555 0184");
    await page.getByLabel("A day that isn’t on the board").check();
    await page.getByLabel("What they asked about").fill("A night dive over the holidays");
    await page.getByLabel("How many divers").fill("3");
    await page.getByRole("button", { name: "Log the call" }).click();

    // Lands where the lead now lives, saying so once.
    await page.waitForURL(/\/shop\/blue-mantis\/requests\?notice=call-logged/);
    await expect(page.getByText("Call logged.")).toBeVisible();
    await expect(page.getByText("Wants to dive: A night dive over the holidays")).toBeVisible();
    await expect(page.getByText("Marisol Cabrera E2E")).toBeVisible();
  });

  test("a caller taking a seat is seated through the same door the booking form uses", async ({
    page,
  }) => {
    await page.goto(CALLS);
    await page.getByLabel("Full name").fill("Ifeoma Balogun E2E");
    await page.getByLabel("Email").fill("ifeoma.balogun.e2e@example.com");
    await page.getByLabel("A seat on a departure with room").check();
    await chooseOpenDeparture(page);
    await page.getByRole("button", { name: "Log the call" }).click();

    // The trip's own roster, with the trip's own notice — which is the proof
    // that this went through `seatNewDiverAction` rather than a fourth path to
    // a booking (the waiver, the activity trail and the analytics event ride
    // with it).
    await page.waitForURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}\?notice=diver-added/);
    await expect(page.getByText("Ifeoma Balogun E2E").first()).toBeVisible();
  });

  /**
   * The wait list is only for a boat with no seat left, and the departure the
   * picker offers here has one. The refusal is the trip page's own — this form
   * never learns capacity for itself, which is what keeps one answer to "is
   * this boat full" in the app.
   */
  test("a wait-list call on a departure that still has room is refused where the seat is", async ({
    page,
  }) => {
    await page.goto(CALLS);
    await page.getByLabel("Full name").fill("Tobias Fenn E2E");
    await page.getByLabel("Email").fill("tobias.fenn.e2e@example.com");
    await page.getByLabel("A seat on a full departure").check();
    await chooseOpenDeparture(page);
    await page.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(
      /\/shop\/blue-mantis\/trips\/[0-9a-f-]{36}\?notice=diver-waitlist-available/,
    );
  });

  test("a caller nobody can ring back is refused beside the button, with the answer kept", async ({
    page,
  }) => {
    await page.goto(CALLS);
    await page.getByLabel("Full name").fill("Nobody Reachable E2E");
    await page.getByLabel("A day that isn’t on the board").check();
    await page.getByLabel("What they asked about").fill("Anything in June");
    await page.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(/[?&]notice=call-reply/);
    await expect(
      page.getByText("Take an email or a phone number, or nobody can ring them back."),
    ).toBeVisible();
    // The branch the staffer chose survives the refusal: they are not asked to
    // re-read three options with somebody on the line.
    await expect(page.getByLabel("What they asked about")).toBeVisible();
  });

  /**
   * A wait-list entry with no address has nobody to invite when a seat frees,
   * and this is the one refusal that differs by outcome — the same caller would
   * have been a perfectly good booking.
   */
  test("a wait-list call with only a phone number is refused for the address", async ({ page }) => {
    await page.goto(CALLS);
    await page.getByLabel("Full name").fill("Phone Only E2E");
    await page.getByLabel("Phone").fill("+1 305 555 0199");
    await page.getByLabel("A seat on a full departure").check();
    await chooseOpenDeparture(page);
    await page.getByRole("button", { name: "Log the call" }).click();

    await page.waitForURL(/[?&]notice=call-email/);
    await expect(page.getByText(/A wait-list entry needs an email address/)).toBeVisible();
  });
});
