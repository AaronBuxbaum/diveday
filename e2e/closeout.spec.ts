import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * The end-of-day close-out ritual (ADR 20260804-day-closeout): staff review
 * how every boat ended, decide what to do with today's leftovers, close the
 * day as a recorded act, and see the record — with nothing locked afterwards.
 */
test.describe("end-of-day close-out", () => {
  test("staff review the day, decide about a leftover, close it, and see the recorded act", async ({
    page,
  }) => {
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/close-out");

    // The three parts of the ritual are all on one page: how the boats ended,
    // what is left over, and tomorrow's first look.
    await expect(page.getByRole("heading", { name: "How today's boats ended" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's leftovers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tomorrow, at a glance" })).toBeVisible();

    // Tomorrow is a *handoff*, not a second queue: it counts what is waiting
    // and links to Today, the only surface that can act on those rows. It must
    // never grow per-row controls again — the same row was actionable on Today
    // and inert here, which taught staff the work waits until morning.
    const tomorrow = page.locator("section", {
      has: page.getByRole("heading", { name: "Tomorrow, at a glance" }),
    });
    await expect(
      tomorrow
        .getByRole("link", { name: "Open Today" })
        .or(tomorrow.getByText("Tomorrow starts clear.")),
    ).toBeVisible();

    // The seed always has a boat sailing today, so the departures list is
    // never empty on the demo shop.
    await expect(page.getByText("No departures today.")).toHaveCount(0);

    // Make an explicit decision about the first leftover: dismiss it. Every
    // other row keeps its carry default.
    const dismissals = page.locator('input[type="radio"][value="dismiss"]');
    await expect(dismissals.first()).toBeVisible();
    await dismissals.first().check();

    // `Close the day` on a fresh day, `Close the day again` on a retry that
    // already closed it — either way it is the same recorded act.
    await page
      .getByRole("button", { name: /^Close the day( again)?$/ })
      .first()
      .click();

    // The recorded act: who closed it, and the dismissed leftover remembered
    // by the choice made about it.
    await expect(page.getByRole("heading", { name: "Day closed" })).toBeVisible();
    await expect(page.getByText(/Closed by Dana Reyes at/)).toBeVisible();
    await expect(page.getByText("— Dismissed").first()).toBeVisible();

    // A closed day never locks: the leftovers are still there to act on, and
    // closing again is just another act on the record.
    await expect(page.getByRole("heading", { name: "Today's leftovers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close the day again" })).toBeVisible();

    // Nothing downstream conditions on the close: Today still renders its own
    // queue, unchanged in kind.
    await page.goto("/shop/blue-mantis");
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
    ).toBeVisible();
  });

  test("Today holds back the close-out handoff while a boat is still out", async ({ page }) => {
    // `lastBoatIsIn` (src/lib/today.ts) offers the close-out only once every one
    // of today's departures is home. The fleet's clock is frozen at 09:30
    // shop-local with boats still out, so only the negative is reachable here —
    // the positive needs an evening instant, and DIVEDAY_CLOCK is one
    // process-wide value shared by server, seed, and browser. The four branches
    // are covered in src/lib/today.test.ts.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis");
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "The last boat is in" })).toHaveCount(0);

    // Absent from Today is not absent from the app — the card is a suggestion,
    // never the only door.
    await page.goto("/shop/blue-mantis/close-out");
    await expect(page.getByRole("heading", { name: "How today's boats ended" })).toBeVisible();
  });

  test("closing again appends another record instead of editing the first", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/close-out");

    // This spec may run after the first one (same seeded shop), so the day
    // may already be closed; close it (again) either way.
    await page
      .getByRole("button", { name: /Close the day( again)?/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Day closed" })).toBeVisible();

    await page.getByRole("button", { name: "Close the day again" }).click();
    await expect(page.getByText(/Closed \d+ times today/)).toBeVisible();
  });
});
