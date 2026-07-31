import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, openTripFromBoard, signInAsOwner } from "./helpers";
import { capture } from "./visual-capture";

signedInAsOwner();

test("staff schedules a trip and it appears on shop and public schedules", async ({ page }) => {
  // Unique title so assertions target this spec's own trip, never a seeded
  // one. (Isolation across tests comes from the per-test demo reset in
  // fixtures.ts, not from this suffix.)
  const title = `Turtle Reef Special ${e2eNow().getTime()}`;

  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: "Full trip form" }).click();
  await expect(page.getByRole("heading", { name: "Schedule a trip" })).toBeVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:30");
  await page.getByLabel("Capacity").fill("8");
  await page.getByLabel("Number of dives").selectOption("3");
  await page.getByLabel("Name").nth(0).fill("Morning reef");
  await page
    .getByLabel("Diver-facing details")
    .nth(1)
    .fill("Second site details will be confirmed at the dock.");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("status")).toBeVisible(); // created banner (param is one-shot)
  await expect(page.getByRole("status")).toContainText(title);

  // View as a diver: signed in, /schedule/[id] renders the staff editor; the
  // public dive-plan briefing ("Your N-dive plan") is the signed-out view.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  const card = page.locator("li").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("8 spots left")).toBeVisible();

  await card.click();
  await expect(page.getByRole("heading", { name: "Your 3-dive plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Morning reef" })).toBeVisible();
  await expect(page.getByText("Second site details will be confirmed at the dock.")).toBeVisible();

  // Cancel the trip — this leg exercises the staff cancel control itself;
  // test isolation is already handled by the per-test demo reset in
  // fixtures.ts.
  const tripUrl = page.url();
  await signInAsOwner(page);
  await page.goto(tripUrl);
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Cancel trip" }).click();
  await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
});

test("end-before-start is rejected with a friendly message", async ({ page }) => {
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill("Backwards Trip");
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("12:00");
  await page.getByLabel("Returns").fill("09:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "end after it starts" })).toBeVisible();
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { name: "Backwards Trip" })).not.toBeVisible();
});

// Visual regression captures for this file's surfaces (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`a trip's staff pages render true to the design (${scheme})`, async ({ page }) => {
      // The seeded reef trip: schedule card → Overview (what the dive is) →
      // Guests (who is attending).
      await page.goto("/shop/blue-mantis/schedule");
      await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
      await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
      await capture(page, "trip-manage", scheme);

      await page
        .getByRole("navigation", { name: "Trip" })
        .getByRole("link", { name: "Guests" })
        .click();
      await page.waitForURL(/\/guests/);
      await page.getByRole("heading", { name: /Divers/ }).waitFor();
      await capture(page, "trip-guests", scheme);
    });

    // H-13: the roster's identity gate gets its own test so its capture never
    // crowds the trip-pages test's time budget. A Night-trip seat booked
    // through a shared inbox under a name that doesn't match the person on
    // file shows the fail-closed "Confirm identity" affordance and blocker
    // until staff vouch for it — a safety-critical state worth a baseline.
    test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
      await page.goto("/shop/blue-mantis/schedule");
      await openTripFromBoard(page, "Night Dive — City of Washington");
      await page
        .getByRole("navigation", { name: "Trip" })
        .getByRole("link", { name: "Guests" })
        .click();
      await page.waitForURL(/\/guests/);
      await page.getByText("Identity unconfirmed").first().waitFor();
      await capture(page, "trip-guests-identity", scheme);
    });

    // H-08: a site deeper than a diver's certification trains for. Warning
    // tone and *outside* the red blocker list, because it never blocks — an
    // instructor may be keeping that diver shallower on purpose. Nothing in
    // the seed reaches this state (every seeded site sits within its divers'
    // ceilings), so the depth is raised for the capture and put back after,
    // matching the nitrox pattern in e2e/nitrox.spec.ts. Its own test so the
    // mutation is contained and reverted regardless of pass/fail.
    test(`the roster's depth warning renders true to the design (${scheme})`, async ({ page }) => {
      const setDepth = async (meters: string) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("link", { name: "Molasses Reef" }).first().click();
        await page.waitForURL(/\/dive-sites\//);
        // The seeded briefing's photo URLs can't be re-ingested from the e2e
        // sandbox and would bounce the save to ?error=images.
        await page.getByLabel(/Site photo URLs/).fill("");
        await page.getByLabel(/Maximum depth/).fill(meters);
        await page.getByRole("button", { name: "Save briefing" }).click();
        await page.getByText("Site briefing saved.").waitFor();
      };
      try {
        await setDepth("32");
        await page.goto("/shop/blue-mantis/schedule");
        await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
        await page
          .getByRole("navigation", { name: "Trip" })
          .getByRole("link", { name: "Guests" })
          .click();
        await page.waitForURL(/\/guests/);
        await page
          .getByText(/deeper than the/)
          .first()
          .waitFor();
        await capture(page, "trip-guests-depth-warning", scheme);
      } finally {
        await setDepth("12");
      }
    });
  });
}
