import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";
import { E2E_CRON_SECRET } from "./servers";

/**
 * A departure that only runs with enough people, and cancels itself when it
 * does not get them (ADR 20260813-minimum-head-count-departures).
 *
 * The whole product claim is the automatic half — a shop's minimum used to
 * live in the trip description, watched by eye and phoned around on the
 * morning of. So this spec fires the actual scheduled pass rather than
 * asserting around it: the form, the promise on the public page, the sweep,
 * the cancellation, and the human override, in the order a shop meets them.
 */

signedInAsOwner();

test("a short departure cancels itself at its deadline, and reinstating it overrules the sweep", async ({
  page,
  request,
}) => {
  // Five sequential journeys before the assertions even begin: build a
  // departure through the full add panel, find it on the board, read it as
  // staff, read it again as a diver, and fire the sweep twice. Same
  // aggregate-cost reasoning add-diver.spec.ts and booking.spec.ts state for
  // their own multi-navigation flows — every individual step resolves, the
  // total just runs past the default 15s budget. Not a hang this would mask:
  // the failing trace showed the trip built and its Overview painted.
  test.setTimeout(30_000);

  const title = `Minimum Charter ${e2eNow().getTime()}`;
  // Departs tomorrow with a 48-hour decision window, so its moment is already a
  // day behind the fleet's frozen clock — the sweep has a decision to make on
  // the very first pass rather than one this spec has to wait for.
  await createTrip(page, {
    title,
    date: daysFromNow(1),
    departsAt: "08:00",
    returnsAt: "13:00",
    capacity: 8,
    price: 120,
    minimumBookings: 4,
    minimumDecisionHours: 48,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const tripUrl = page.url();
  const tripId = tripUrl.match(/\/trips\/([^/?]+)/)?.[1];
  if (!tripId) throw new Error("could not read the trip id from the URL");

  // Staff see it before the sweep does: nobody has booked, the moment has
  // passed, and the band says what is about to happen and how to stop it.
  await expect(page.getByText("Minimum head count")).toBeVisible();
  await expect(page.getByRole("heading", { name: /4 divers short of the 4/ })).toBeVisible();
  await expect(page.getByText(/DiveDay will cancel this departure/)).toBeVisible();

  // And so does a diver, before they pay — which is what makes the automatic
  // cancellation a promise kept rather than a shop changing its mind.
  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await expect(page.getByText(/runs with at least 4 divers/)).toBeVisible();

  // Nothing has happened yet. The sweep is the only thing that cancels for a
  // minimum, so until it runs the departure is still on the board.
  await page.goto(tripUrl);
  await expect(page.getByText("Cancelled")).toHaveCount(0);

  // The scheduled routes fail closed: no bearer token, no pass, no writes.
  const unauthorized = await request.get("/api/cron/minimum-seats", {
    headers: { authorization: "Bearer not-the-secret" },
  });
  expect(unauthorized.status()).toBe(401);

  const swept = await request.get("/api/cron/minimum-seats", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(swept.ok()).toBe(true);
  expect((await swept.json()).cancelled).toBeGreaterThanOrEqual(1);

  await page.goto(tripUrl);
  await expect(page.getByText("Cancelled").first()).toBeVisible();

  // The shop always gets the last word. Reinstating *is* "run it anyway", so it
  // clears the minimum — otherwise the next hourly pass would cancel the same
  // departure again and the shop would be arguing with a cron job.
  await page.getByRole("button", { name: "Reinstate trip" }).click();
  // Wait for the badge to *go*, not for the minimum-seats section to be absent.
  // Both are absence assertions, but only this one bars anything: the badge is
  // on the page right now (asserted four lines up), so it can only disappear
  // once the reinstate has landed. "Minimum head count" is a section eyebrow
  // that need not be on this render at all, so waiting for its absence could
  // pass instantly and let the sweep below fire while the reinstate was still
  // in flight — which is the only way this test can see "Cancelled" again.
  // `cancelDeparturesBelowMinimum` cannot re-cancel a reinstate that has
  // committed (its UPDATE carries `minimum_bookings is not null`, and
  // reinstating clears the minimum in the same statement that sets the status),
  // so there is no product race here to hide. Failed exactly once this way on
  // 2026-08-14 and never reproduced, which is what a vacuous barrier looks like.
  await expect(page.getByText("Cancelled")).toHaveCount(0);
  await expect(page.getByText("Minimum head count")).toHaveCount(0);

  const again = await request.get("/api/cron/minimum-seats", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(again.ok()).toBe(true);

  await page.goto(tripUrl);
  await expect(page.getByText("Cancelled")).toHaveCount(0);
});

/**
 * The other half of the rule: a departure that met its number is not touched,
 * and says nothing at all about minimums to anybody. "This is going ahead" is
 * what a scheduled trip already means.
 */
test("a departure that filled is left alone, and stops mentioning its minimum", async ({
  page,
  request,
}) => {
  // Same reasoning as the test above: build a departure, find it, seat a diver
  // through the Guests form, then two more page loads and a sweep.
  test.setTimeout(30_000);

  const title = `Filled Charter ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(1),
    departsAt: "09:00",
    returnsAt: "14:00",
    capacity: 8,
    minimumBookings: 1,
    minimumDecisionHours: 48,
  });

  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  const tripUrl = page.url();

  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill("Meets The Minimum");
  await page.getByLabel("Email").fill(`meets-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/]+\/guests/);

  await page.goto(tripUrl);
  await expect(page.getByText("Minimum head count")).toHaveCount(0);

  await request.get("/api/cron/minimum-seats", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  await page.goto(tripUrl);
  await expect(page.getByText("Cancelled")).toHaveCount(0);
});
