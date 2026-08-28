import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  daysFromNow,
  e2eNow,
  openTripFromBoard,
  seededTripId,
} from "./helpers";

/**
 * The weather blow-out cascade (docs ADR 20260804-blowout-cascade): staff tap
 * once on a departure, confirm, and every booked diver's message goes out with
 * rebooking options while the cascade record tracks who is still unresolved.
 *
 * The e2e fleet runs with no email provider configured, so every send lands
 * as "Not sent" on the cascade surface — which is itself the honest state the
 * feature must render: a shop with no email set up still gets the cancelled
 * trip, the per-diver record, and the phone-list fallback.
 */

signedInAsOwner();

const SHOP = "blue-mantis";
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe("weather blow-out cascade", () => {
  test("one tap, one confirm: cancel the reef charter and land on the cascade record", async ({
    page,
  }) => {
    // `openTripFromBoard` clicks a row on the board; it does not navigate to
    // it. `signedInAsOwner` only seeds storage state, so without this the test
    // ran against a blank page and timed out looking for the listitem.
    await page.goto(`/shop/${SHOP}/schedule/board`);
    await openTripFromBoard(page, REEF_TRIP);

    // One tap on the trip page leads to a real confirm page — never a
    // zero-confirm cancel of live bookings (the feature's guardrail).
    await page.getByRole("link", { name: "Weather blow-out…" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Call a blow-out?" })).toBeVisible();
    // The confirm names the roster it is about to message.
    await expect(page.getByRole("heading", { name: /divers? will be messaged/ })).toBeVisible();

    await page.getByRole("button", { name: "Call the blow-out" }).click();
    await expect(page.getByRole("status")).toContainText("Blow-out called");
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();

    // The cascade record: per-diver rows with message, money, offers, and
    // resolution state. With no provider configured every message reads
    // "Not sent" and every diver is unresolved — the retry affordance shows.
    await expect(page.getByRole("columnheader", { name: "Diver" })).toBeVisible();
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.getByText("Not sent").first()).toBeVisible();
    await expect(page.getByText("Unresolved").first()).toBeVisible();

    // Offers were computed per diver even though the sends failed: at least
    // one row names an alternative departure, and none of them is the
    // cancelled reef charter itself.
    const offersColumn = page.locator("tbody td:nth-child(4)");
    const offersText = (await offersColumn.allTextContents()).join(" · ");
    expect(offersText.length).toBeGreaterThan(0);
    expect(offersText).not.toContain(REEF_TRIP);

    // Resume is idempotent from the surface too: retrying re-walks only the
    // unsent rows and lands back on the same record.
    await page.getByRole("button", { name: "Retry unsent messages" }).click();
    await expect(page.getByRole("status")).toContainText("Retried the unsent messages.");
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();

    // The trip record now reads cancelled and keeps the way back to the
    // cascade; the quiet per-trip cancel control is gone with it.
    await page.getByRole("link", { name: "Back to the trip" }).click();
    // Not `exact: true`: the status is a `<Badge tone="danger">`, which renders
    // an aria-hidden glyph inside the same span as the label, so the element's
    // text is "❌Cancelled" and no element has the exact text "Cancelled".
    // `import.spec.ts` matches this badge the same way. The "Reinstate trip"
    // button on the next line is what makes the pair specific to a cancelled
    // trip rather than to any prose containing the word.
    await expect(page.getByText("Cancelled").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
    await page.getByRole("link", { name: "View the blow-out cascade" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();
  });

  test("a departure with zero bookings blows out as a clean no-op cascade", async ({ page }) => {
    // Put an empty departure on the board, then blow it out.
    const title = `Blowout Empty ${e2eNow().getTime()}`;
    await page.goto(`/shop/${SHOP}/schedule/board`);
    await page.getByRole("link", { name: "Add a departure", exact: true }).click();
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(4));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByLabel("Seats").fill("6");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    // Named, so a staffer adding several departures in a row can read which one
    // landed (ADR 20260806-one-trip-create-form).
    await expect(page.getByRole("status")).toContainText(`“${title}” is on the board.`);

    await openTripFromBoard(page, title);
    await page.getByRole("link", { name: "Weather blow-out…" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Call a blow-out?" })).toBeVisible();
    await expect(page.getByText("Nobody is booked on this departure.")).toBeVisible();

    await page.getByRole("button", { name: "Call the blow-out" }).click();
    await expect(page.getByRole("status")).toContainText("Blow-out called");
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();
    await expect(
      page.getByText("No divers were booked when the blow-out was called."),
    ).toBeVisible();
  });

  test("the stranded diver's own link says the trip was cancelled, not 'welcome back'", async ({
    page,
  }) => {
    // **The other side of the cascade**, and the half nothing looked at until a
    // review did (2026-08-28). A blow-out cancels the *trip* and deliberately
    // leaves every booking active — refunds stay a per-booking staff decision —
    // so the diver's own `/ready` link, the durable one in their confirmation
    // and in every reminder, read a booking that was still perfectly fine. It
    // handed them a packing list before the boat was due back and, an hour
    // after it was due back, "Welcome back" with a dive record naming the boat
    // and the crew, a request to rate the day and an invitation to tip them.
    //
    // The seeded reef charter, for the same reasons the first test in this file
    // uses it: it is known publicly bookable (e2e/schedule-trip.spec.ts takes a
    // seat on it) and known blow-out-able. Each test resets the schedule before
    // it runs, so cancelling it here is nobody else's problem.
    const tripId = await seededTripId(page, SHOP, REEF_TRIP);

    // A diver takes a seat and keeps the link they land on — this is the URL
    // that lives in their inbox for the rest of the season.
    await page.goto(`/s/${SHOP}/trips/${tripId}`);
    await bookASeatAndOpenThread(page, "Stranded Reader");
    const threadUrl = page.url();
    await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();

    // The captain calls it off.
    await page.goto(`/shop/${SHOP}/schedule/board`);
    await openTripFromBoard(page, REEF_TRIP);
    await page.getByRole("link", { name: "Weather blow-out…" }).click();
    // Wait on what the confirm page itself renders before clicking through it
    // — the click is a navigation, not an in-place toggle.
    await expect(page.getByRole("heading", { level: 1, name: "Call a blow-out?" })).toBeVisible();
    await page.getByRole("button", { name: "Call the blow-out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();

    // The same link, unchanged, opened again.
    await page.goto(threadUrl);
    await expect(
      page.getByRole("heading", { level: 1, name: "This trip was cancelled" }),
    ).toBeVisible();
    // Nothing left to prepare for, a way back to the shop's schedule, and the
    // shop's own name — a diver reading this needs somebody to ask (issue #801).
    await expect(page.getByRole("heading", { name: "Pack with confidence" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /See what.s next/ })).toBeVisible();
    await expect(page.getByText(/Blue Mantis Divers/).first()).toBeVisible();
  });
});
