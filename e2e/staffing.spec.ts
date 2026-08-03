import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

/**
 * The staffing board (`/shop/[shopSlug]/staffing`): who is working in a window,
 * what each person can teach or crew, and which departures still have a
 * coverage gap. It shipped with no e2e or visual coverage at all — the
 * 2026-08-03 test-system evaluation found it, which is why
 * `scripts/route-coverage.json` carried an exemption for this route until this
 * spec landed.
 *
 * Two things worth knowing before reading the assertions:
 *
 * - The seed gives **every** staff member one 12-hour shift today
 *   (`src/db/seed.ts`, "Demo schedule"), so the default window (today through
 *   six days out) is never empty and "Not scheduled in this window." only
 *   appears once the window moves off today.
 * - The window form is a plain `method="get"` form and the whole page is
 *   server-rendered from `getStaffingView(db, shopId, from, to)`, so a changed
 *   list after submitting it is proof the *server* re-queried — nothing here
 *   filters client-side. The URL itself is not assertable: `FlashParams`
 *   strips `from`/`to`/`notice` with `history.replaceState` shortly after
 *   mount, so the rendered list is the stable signal.
 */

const STAFFING = "/shop/blue-mantis/staffing";

/** One staff member's card in "Who is working" — scoped so a Remove button, a
 * time range, or the not-scheduled warning is read off *that* person's row. */
function staffCard(page: import("@playwright/test").Page, name: string) {
  return page.locator("article").filter({ hasText: name }).filter({ visible: true });
}

test.describe("staffing", () => {
  signedInAsOwner();

  test("an owner schedules a shift, narrows the window past it, and takes it back off", async ({
    page,
  }) => {
    // A create, a window submit, and a delete — three full server round trips
    // plus their re-renders, past the suite's 15s single-flow default.
    test.setTimeout(30_000);
    const shiftDay = daysFromNow(2);
    // Unique so the assertions target this spec's own shift rather than the
    // seeded "Demo schedule" one. (Isolation itself comes from the per-test
    // demo reset in fixtures.ts.)
    const note = `Boat 2 ${e2eNow().getTime()}`;

    await page.goto(STAFFING);
    await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();

    const keiko = staffCard(page, "Keiko Tanaka");
    // The seeded shift is today, so it is inside the default window.
    await expect(keiko.getByText("Demo schedule")).toBeVisible();

    await page.getByLabel("Staff member").selectOption({ label: "Keiko Tanaka" });
    await page.getByLabel("Date").fill(shiftDay);
    await page.getByLabel("Starts").fill("06:30");
    await page.getByLabel("Ends").fill("14:45");
    await page.getByLabel("Note").fill(note);
    await page.getByRole("button", { name: "Add shift" }).click();

    await expect(page.getByText("Shift saved.")).toBeVisible();
    // The stored range read back through the shop's own timezone
    // (`formatTimeRangeTz`, which labels the end) — not the raw wall time the
    // form was typed in, so this fails if the shift is written in the wrong zone.
    const newShift = keiko.getByRole("listitem").filter({ hasText: note });
    await expect(newShift).toHaveCount(1);
    await expect(newShift.getByText("6:30 AM – 2:45 PM EDT")).toBeVisible();

    // Narrow the window past both shifts. Nothing on this page filters in the
    // browser: this is a GET submit and a fresh server render.
    await page.getByLabel("From").fill(daysFromNow(4));
    await page.getByLabel("Through").fill(daysFromNow(5));
    await page.getByRole("button", { name: "Show window" }).click();

    await expect(keiko.getByText("Not scheduled in this window.")).toBeVisible();
    await expect(keiko.getByText(note)).toHaveCount(0);
    await expect(keiko.getByText("Demo schedule")).toHaveCount(0);

    // Back to the shift's own day, where it is visible again, and take it off.
    await page.getByLabel("From").fill(shiftDay);
    await page.getByLabel("Through").fill(shiftDay);
    await page.getByRole("button", { name: "Show window" }).click();
    await expect(keiko.getByText(note)).toBeVisible();

    await keiko
      .getByRole("listitem")
      .filter({ hasText: note })
      .getByRole("button", { name: "Remove" })
      .click();
    // The delete redirects to the page's own default window (it carries only
    // `?notice=`, not the from/to the removal was performed in), so this lands
    // back on today's week: the seeded shift is there, this spec's is gone.
    await expect(page.getByText("Shift removed.")).toBeVisible();
    await expect(keiko.getByText(note)).toHaveCount(0);
    await expect(keiko.getByText("Demo schedule")).toBeVisible();
  });

  test("a departure with nobody on shift reads as a coverage gap, not a covered boat", async ({
    page,
  }) => {
    // Create the departure, then read it back off staffing — two navigations
    // and two server round trips.
    test.setTimeout(30_000);
    const tripDay = daysFromNow(3);
    const title = `Unstaffed charter ${e2eNow().getTime()}`;

    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(tripDay);
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto(STAFFING);
    await page.getByLabel("From").fill(tripDay);
    await page.getByLabel("Through").fill(tripDay);
    await page.getByRole("button", { name: "Show window" }).click();

    // Nobody is on shift three days out (the seed's shifts are all today), and
    // this departure has no crew — the two gaps `getStaffingView` computes
    // independently of each other.
    const coverage = page.locator("article").filter({ hasText: title }).filter({ visible: true });
    await expect(coverage.getByText("2 gaps")).toBeVisible();
    await expect(coverage.getByText("No crew assigned")).toBeVisible();
    await expect(coverage.getByText("No working shift covers this trip")).toBeVisible();
    await expect(
      coverage.getByText("Crew is assigned, and their shift covers this trip."),
    ).toHaveCount(0);
  });
});

test.describe("staffing, as the daily crew", () => {
  signedInAs("captain");

  test("a captain reads who is working but gets no shift controls", async ({ page }) => {
    // Shift changes are owner/manager work (`canPersonManageStaffAccounts`,
    // and `requireStaffingManager` refuses the actions server-side); the crew
    // still needs to see who is on today. Same shape as the schedule board's
    // "a captain sees the board but none of its controls".
    await page.goto(STAFFING);
    await expect(page.getByRole("heading", { level: 1, name: "Staffing" })).toBeVisible();
    await expect(staffCard(page, "Keiko Tanaka").getByText("Demo schedule")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Add a working shift" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add shift" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByText("Shift changes require owner or manager")).toHaveCount(0);
  });
});
