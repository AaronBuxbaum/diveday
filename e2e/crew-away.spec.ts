import { weekStartOf } from "@/lib/week-board";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openTripAbout,
  selectCrewByName,
  tripPathByTitle,
} from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";

/**
 * **Rostered and away, said where the shop plans** (fourth review, item 12).
 * Marcus Webb marked himself away for a weekend and stayed rostered on the
 * Sunday session; only the staffing week's Crew grid said so. The demo marks
 * him away three days out (`seedCrewAway`), so the spec rosters him on
 * a departure of its own that day and goes to the board,
 * where the shop plans the week. Informs, never gates: the assignment stands.
 * The owner's Today row (`crew_away`) is pinned in `src/features/today/today-reader.test.ts`: a
 * departure three days out is counted in Today's "This week" line, not named.
 */
test("a crew member away on a day they are rostered is named on the board", async ({ page }) => {
  test.setTimeout(60_000);
  const title = `Away-day refresher ${e2eNow().getTime()}`;
  const day = daysFromNow(3);
  await createTrip(page, { title, date: day, departsAt: "09:00", returnsAt: "12:00" });

  await page.goto(await tripPathByTitle(page, SHOP, title));
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  await selectCrewByName(page, "Marcus Webb");
  // Still assignable: a day away is somebody's note, not a refusal.
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();

  await page.goto(`/shop/${SHOP}/schedule/board?week=${weekStartOf(day)}`);
  await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
  const row = page.locator("li").filter({ hasText: title }).last();
  await expect(row.getByText(/^Marcus Webb away /)).toBeVisible();
});
