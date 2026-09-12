import type { Page } from "@playwright/test";
import { weekStartOf } from "@/lib/week-board";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripAbout, tripPathByTitle } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
const BOARD = `/shop/${SHOP}/schedule/board`;

/** The builder's controls name a departure by title, day, and time — see ScheduleBuilder. */
function rowActions(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) });
}

/** Opens the row's action list, then chooses one of Move / Copy / Remove. */
async function chooseRowAction(page: Page, verb: string, title: string) {
  await rowActions(page, title).first().click();
  await page
    .getByRole("button", { name: new RegExp(`^${verb} ${title},`) })
    .first()
    .click();
}

/**
 * **A crew clash outlives the panel that warned about it** (issue #1695).
 *
 * `setTripCrew` and `changeTripCrew` both refuse to put one person on two
 * departures whose hours overlap, so the only way a shop reaches that state is
 * `moveTrip`: it slides a departure's window and never looks at crew. The one
 * surface that ever said so was the schedule board's Move panel — which closes
 * the moment the move goes through, after which the moved departure's own Crew
 * panel listed the person with no mark and the staffing week showed them on
 * both boats as if it were a shift pattern.
 *
 * The spec builds the state the way a shop does, through the real move, and
 * then goes looking for it on the two surfaces a staffer opens next. Its two
 * departures are its own rather than the seed's: the demo shop deliberately
 * runs one boat a day, so there is nothing to land on, and a seeded charter
 * another worker may be mutating is not a stable host either.
 */
test.describe("a standing crew clash", () => {
  test("survives the Move panel that warned about it, on both surfaces", async ({ page }) => {
    // Two creates, two crew assignments, a move, and three page loads — the
    // aggregate cost of a whole flow, not a hang.
    test.setTimeout(60_000);
    const stamp = e2eNow().getTime();
    const drift = `Reef drift ${stamp}`;
    const twoTank = `Early two-tank ${stamp}`;
    // Inside the board's first keyset page, and inside the staffing week the
    // `?week=` below asks for.
    const day = daysFromNow(3);

    // The host: 09:00 to 13:00. And the boat that will land on it, tied up an
    // hour before it sails — a state the roster happily writes, because it is
    // an ordinary double shift.
    await createTrip(page, { title: drift, date: day, departsAt: "09:00", returnsAt: "13:00" });
    await createTrip(page, { title: twoTank, date: day, departsAt: "06:30", returnsAt: "08:00" });

    for (const title of [drift, twoTank]) {
      await page.goto(await tripPathByTitle(page, SHOP, title));
      await openTripAbout(page);
      // Every control in this panel is wired through React handlers, so a pick
      // made before hydration silently does nothing.
      await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
      await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
      await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
      // Nothing is wrong yet: the two boats do not overlap, so neither panel
      // says a word about the other.
      await expect(page.locator("#crew").getByText(/cannot be on both/)).toHaveCount(0);
    }

    // The move that manufactures the clash: 06:30 slides to 09:00, straight on
    // top of the drift, and `moveTrip` never looks at the crew.
    await page.goto(BOARD);
    await page.getByRole("heading", { name: "Board", level: 1 }).waitFor();
    await chooseRowAction(page, "Move", twoTank);
    await page.getByLabel("New date").fill(day);
    await page.getByLabel("New departure time").fill("09:00");
    // The Move panel does say so — which is the whole of what the shop used to
    // be told, and it is about to close.
    await expect(
      page.getByText(`Marcus Webb is already crewing ${drift} at that time and cannot be on both.`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Move it" }).click();
    await expect(page.getByRole("status")).toContainText("Moved.");
    // Gone with the panel, exactly as before this issue.
    await expect(page.getByText(/is already crewing/)).toHaveCount(0);

    // **The departure's own page**, which is where a staffer looks next.
    await page.goto(await tripPathByTitle(page, SHOP, twoTank));
    await openTripAbout(page);
    await expect(page.locator("#crew").getByRole("status")).toContainText(
      `Also crewing ${drift} at these hours and cannot be on both.`,
    );
    // Still nobody's gate: the roster is the owner's, so every control on the
    // row keeps working (issue #1345).
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeEnabled();

    // **And the week the shop plans on.** `?week=` snaps any date to its own
    // Monday (`resolveWeekStart`), so this is the week the clash falls in
    // whatever weekday the frozen clock lands on.
    await page.goto(`/shop/${SHOP}/staffing?week=${weekStartOf(day)}`);
    await page.getByRole("heading", { name: "Staffing", level: 1 }).waitFor();
    // Both chips say it, each naming the other boat: a manager fixes this from
    // whichever one they opened. `.first()` because the week renders as a grid
    // above `lg` and as a day list below it, and one of the two is hidden.
    await expect(page.getByText(`Also on ${drift}: cannot be on both`).first()).toBeVisible();
    await expect(page.getByText(`Also on ${twoTank}: cannot be on both`).first()).toBeVisible();
  });
});
