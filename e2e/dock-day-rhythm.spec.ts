import { expect, test } from "./fixtures";
import { daysFromNow, openSettingsRow, seededTripId, signInAsOwner } from "./helpers";

/**
 * The dock-day rhythm, end to end: six numbers a shop types in Settings, and
 * the day a diver reads on the booking page because of them
 * (ADR 20260812-configurable-dock-day-rhythm).
 *
 * What this guards is the join. The rhythm's arithmetic has unit tests
 * (src/lib/diver-planning.test.ts) and its authorization has its own
 * (settings/actions.authz.test.ts), but neither can see the thing that was
 * actually broken before: the diver-facing timeline was *derived* — the
 * briefing from a formula, the two beats on the water from the trip window's
 * own thirds — so no setting a shop could reach changed it. A green unit suite
 * over a timeline nothing feeds is exactly the shape that bug had.
 *
 * The shop this drives is one that briefs on the boat and dives from the
 * shore, because those are the two beats that had no way to be switched off.
 *
 * It is a shop of this test's own (`privateShop`, ADR
 * 20260815-per-test-private-shops), not the shared blue-mantis fixture. Five
 * `shops` columns are the whole point of the test, and `resetDemoSchedule`
 * restores three columns of that table and no others — so before this, every
 * later spec and visual capture in the same worker read a shop that briefs for
 * zero minutes and does not ride out to the site.
 */

test("a shop's own minutes are the day the diver reads", async ({ page, privateShop }) => {
  // A mint, a live sign-in, a settings save, and two page loads on the diver's
  // side, all inside this test's own budget.
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;

  await page.goto(`/shop/${SHOP}/settings`);
  await openSettingsRow(page, "Dock-day rhythm");

  // Briefs on the boat, kits up at the dock, walks in off the beach.
  await page.getByLabel("Briefing before departure").fill("0");
  await page.getByLabel("Gear set-up before departure").fill("20");
  await page.getByLabel("Ride out to the first site").fill("0");
  await page.getByLabel("Time in the water per dive").fill("40");
  await page.getByLabel("Surface interval between dives").fill("50");
  await page.getByRole("button", { name: "Save dock-day rhythm" }).click();

  // The strip under the form is the same arithmetic the booking page runs,
  // so it is what tells the shop the save landed — no beat they turned off,
  // and the one they turned on. Scoped to the strip itself: every beat's name
  // also reads as a *field label* a few lines above it ("Ride out to the
  // first site"), so a page-wide text assertion here passes on the form and
  // never looks at the day at all.
  const preview = page.locator("dl").filter({ hasText: "Arrive and check in" });
  await expect(preview).toContainText("Gear set-up");
  await expect(preview).toContainText("Dive 2");
  await expect(preview).not.toContainText("Crew briefing");
  await expect(preview).not.toContainText("Ride out");

  // Zero bottom time is the one beat with no "we don't do that" reading, and
  // the box itself refuses it before a submission is ever made — the server
  // refuses a forged one too (src/lib/diver-planning.test.ts).
  const bottomTime = page.getByLabel("Time in the water per dive");
  await bottomTime.fill("0");
  expect(await bottomTime.evaluate((box: HTMLInputElement) => box.checkValidity())).toBe(false);
  await bottomTime.fill("40");

  // And now the diver's side of the same numbers.
  // By href, not by title: several departures on the schedule share a name
  // with the *course* they teach, and a by-name click lands on the course
  // page — which has no rhythm on it at all.
  await page.goto(`/s/${SHOP}`);
  await page.locator(`a[href^="/s/${SHOP}/trips/"]`).first().click();
  await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();

  const rhythm = page.getByRole("list").filter({ hasText: "Arrive and check in" }).last();
  await expect(rhythm).toContainText("Set up your gear");
  await expect(rhythm).toContainText("Dive 1");
  // Both turned off in Settings a moment ago. Before the rhythm was a set of
  // shop settings these two were unconditional, so this pair of assertions is
  // the whole fix in one place.
  await expect(rhythm).not.toContainText("Crew briefing");
  await expect(rhythm).not.toContainText("Ride out to the site");

  // The packing list stops promising a briefing the shop just said it does
  // not run — the two used to sit three inches apart and disagree.
  const provided = page.getByRole("list").filter({ hasText: "Tanks and weights" }).last();
  await expect(provided).not.toContainText("Crew briefing");
});

/**
 * The other half of the same join, one leg down: a departure's own run between
 * sites (ADR 20260815-per-leg-travel-minutes).
 *
 * A real two-tank shape rather than a unit fixture, because what the unit suite
 * cannot see is whether the number a staffer types into the dive plan ever
 * reaches the timeline a diver reads — which is the exact shape of the bug the
 * rhythm itself had before it was configurable.
 *
 * The shop is untouched: every number below comes off the trip. That is the
 * point of the fallback, so the assertions are worth reading against the
 * default rhythm (30 / 0 / 15 / 20 / 45 / 60) rather than against anything this
 * test set up.
 */
test("a departure's own legs are the day the diver reads", async ({ page, privateShop }) => {
  // A mint, a live sign-in, a trip creation, and two page loads.
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;
  const TITLE = "Wall run — two tanks";

  // The one place a trip is created (ADR 20260806-one-trip-create-form), at the
  // depth where the per-dive plan is disclosed.
  await page.goto(`/shop/${SHOP}/schedule/board?add=full`);
  await page.getByLabel("What is it").fill(TITLE);
  await page.getByLabel("Date").fill(daysFromNow(9));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("15:00");
  await page.getByLabel("Number of dives").selectOption("2");
  // Ten minutes out to the house reef, then a long run across to the wall —
  // the pair one `trips.boat_ride_minutes` could never have expressed, and the
  // reason the second leg is longer than the surface interval it displaces.
  await page.locator('input[name="dive-1-travelMinutes"]').fill("10");
  await page.locator('input[name="dive-2-travelMinutes"]').fill("150");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(TITLE);

  // Reached by id rather than by clicking the public schedule. That list is a
  // keyset-paged stream (ADR 20260803-one-pagination-model's one exception),
  // and a freshly minted private shop seeds enough departures that its first
  // page ends before this trip's date — so clicking through it made the test a
  // hostage to how densely the fixture seeds, which is not what it is testing.
  // `seededTripId` walks the staff board's own pages to find the departure.
  const tripId = await seededTripId(page, SHOP, TITLE);
  await page.goto(`/s/${SHOP}/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();

  const rhythm = page.getByRole("list").filter({ hasText: "Arrive and check in" }).last();
  // Dive one at the trip's own ten minutes, not the shop's twenty: 8:00 + 0:10.
  await expect(rhythm.getByRole("listitem").filter({ hasText: "Dive 1" })).toContainText("8:10 AM");
  // ...and dive two 45 under plus a 150-minute run, rather than the 60-minute
  // surface interval it would have read at the shop's numbers alone (10:05 AM).
  await expect(rhythm.getByRole("listitem").filter({ hasText: "Dive 2" })).toContainText(
    "11:25 AM",
  );
  // The run is what constrains that window, so it is what the diver is told —
  // and it says "next site", because a ride out is a thing that happens once.
  await expect(rhythm).toContainText("Ride to the next site");
  await expect(rhythm).not.toContainText("Surface interval");
});

/**
 * The same join a third time, and the one neither test above can make: **the
 * seeded demo shop states legs of its own**
 * (FU-20260815-the-demo-shop-runs-every-leg-at-twenty-minutes).
 *
 * Both tests above build their fixture through the real forms, which is the
 * right way to prove the *code* path and says nothing about the demo. Every
 * seeded `trip_dives` row left `travel_minutes` null until
 * `src/db/seed-trip-legs.ts`, so every departure a shop owner clicked through
 * fell back to the shop's single twenty-minute figure and the feature was
 * invisible in the product's own shop window.
 *
 * The long-range run is the departure worth asserting: it is the only seeded one
 * whose second leg is longer than the shop's surface interval, which is the only
 * shape that changes which beat a diver reads. Read-only against the shared
 * blue-mantis fixture — it writes nothing, and in particular touches none of the
 * shop-level settings that would need a shop of its own.
 */
test("the demo shop's long-range run reads its own legs", async ({ page }) => {
  // A live sign-in and a board crawl before the page under test even loads.
  test.setTimeout(45_000);
  await signInAsOwner(page);
  const tripId = await seededTripId(
    page,
    "blue-mantis",
    "Tortugas Run — 3 days out, 6 divers to sail",
  );

  await page.goto(`/s/blue-mantis/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();
  const rhythm = page.getByRole("list").filter({ hasText: "Arrive and check in" }).last();

  // Departs 6:30 AM. Two hours out to the Tortugas rather than the shop's
  // twenty minutes, which would have put dive one at 6:50.
  await expect(rhythm.getByRole("listitem").filter({ hasText: "Dive 1" })).toContainText("8:30 AM");
  // Then a 75-minute run between sites, which is longer than the 60-minute
  // interval it displaces — so the window is a ride, and dive two lands at
  // 8:30 + 45 under + 75 across rather than at the interval's 10:15.
  await expect(rhythm).toContainText("Ride to the next site");
  await expect(rhythm.getByRole("listitem").filter({ hasText: "Dive 2" })).toContainText(
    "10:30 AM",
  );
  // ...and the third leg is short enough to disappear back into the interval,
  // which is the other half of the same rule and the state most of the seeded
  // board is deliberately left in.
  await expect(rhythm).toContainText("Surface interval");
});
