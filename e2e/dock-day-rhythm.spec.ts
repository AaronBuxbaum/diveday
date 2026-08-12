import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAs, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

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
 */
const SHOP = DEMO_SHOP_SLUG;

test.describe("as owner", () => {
  signedInAs("owner");

  test("a shop's own minutes are the day the diver reads", async ({ page }) => {
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
});
