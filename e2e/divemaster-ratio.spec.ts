import { expect, test } from "./fixtures";
import { openSettingsRow, openTripAbout, seededTripId } from "./helpers";

/**
 * The shop's target diver:divemaster ratio, end to end: one number typed in
 * Settings, and the sentence a manager reads on a departure because of it
 * (ADR 20260820-shop-divemaster-ratio).
 *
 * What this guards is the join, and the fact that the join is **advice**. The
 * arithmetic has unit tests (`src/lib/divemaster-ratio.test.ts`) and so does
 * the planner that reads it (`src/lib/request-advisor.test.ts`), but neither
 * can see the two things that actually matter here: that a number a shop
 * types reaches the departure page at all, and that being under target
 * refuses nothing — the crew panel still edits, the roster still seats.
 *
 * That second half is the whole difference between this and the agency course
 * ratios beside it (`src/lib/course-ratios.ts`), which really do refuse a seat.
 *
 * It takes a shop of its own (`privateShop`, ADR
 * 20260815-per-test-private-shops): `divers_per_divemaster` is a `shops`
 * column, `resetDemoSchedule` restores three columns of that table and this is
 * not one of them, so writing it on the shared fixture would leave every later
 * spec in the worker reading a shop whose target this test chose.
 */
test("a shop's target ratio reaches the departure, and refuses nothing", async ({
  page,
  privateShop,
}) => {
  // A mint, a live sign-in, two settings saves and three page loads.
  test.setTimeout(60_000);
  const SHOP = privateShop.slug;

  await page.goto(`/shop/${SHOP}/settings`);
  await openSettingsRow(page, "Diving options");

  // 1:1 — tighter than any crew a seeded departure carries, so "under target"
  // is a fact about the number rather than about how the demo happens to be
  // staffed. Today's charter is in fact crewed by nobody in the water at all:
  // `seed-trips.ts` rosters the shop's divemaster as its *captain* on the first
  // charter, on purpose, and `inWaterCrewRole` counts a captain as nobody.
  await page.getByLabel("Divers per divemaster").fill("1");
  await page.getByRole("button", { name: "Save diving options" }).click();
  // The hub row states what it holds, so the saved target is readable without
  // opening the row again — and it is the settled signal that the save landed.
  await expect(page.getByText("1:1 divers per divemaster")).toBeVisible();

  const tripId = await seededTripId(page, SHOP, "Two-Tank Reef — Molasses & French");
  await page.goto(`/shop/${SHOP}/trips/${tripId}`);

  // `#crew`, not a heading filter: the conditions panel further down is also a
  // `<section>` whose text starts "Crew prediction", and a name filter matches
  // both.
  const crew = page.locator("section#crew");
  await expect(crew).toContainText("your 1:1 target wants 9 divemasters");

  // Advice, not a gate: the panel a shop fixes this in is still fully working
  // while the departure is under target, and nothing on the page has refused.
  await expect(crew.getByRole("combobox").first()).toBeEnabled();

  // The other half of the join: the crew this departure needs is *derived* from
  // the number, not a constant that happens to read 9. Same nine divers, same
  // empty water, one loose target — one divemaster.
  await page.goto(`/shop/${SHOP}/settings`);
  await openSettingsRow(page, "Diving options");
  await page.getByLabel("Divers per divemaster").fill("20");
  await page.getByRole("button", { name: "Save diving options" }).click();
  await expect(page.getByText("20:1 divers per divemaster")).toBeVisible();

  await page.goto(`/shop/${SHOP}/trips/${tripId}`);
  await expect(crew).toContainText("your 20:1 target wants 1 divemaster");
});
