import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { offlineCopySaved, STAFF_DAY_HEADING, signInAs, signInAsOwner } from "./helpers";

/**
 * **Closing the day, on the shop home** — ADR
 * 20260827-clearwater-surface-language, decision 4, and H-62.
 *
 * The end-of-day ritual (ADR 20260804-day-closeout) kept every one of its
 * facts and lost its route. The stations of the home's spine settle one by one
 * as head counts close; the closing block — the leftovers, each with its own
 * Dismiss, then the one closing act — appears beneath them once every
 * departure of the shop day has ended, with the standing one-hour buffer.
 *
 * The seeded demo day is deliberately mid-morning, which is exactly what the
 * first test needs and exactly what the second cannot use. `seed-evening`
 * moves the day's departures behind the frozen clock instead of moving the
 * clock, which is process-wide (`e2e/servers.ts`).
 */
test.describe("the day closes on the home", () => {
  test("holds the closing block back while a boat is still out", async ({ page }) => {
    // The pin, end to end. At the fleet's frozen 09:30 shop-local the demo has
    // a first-light boat home and a later one still on the water — so the
    // settled station is there with its own reading, and nothing on the page
    // offers to close a day that is not over.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();

    await expect(page.getByRole("button", { name: /^Close the day/ })).toHaveCount(0);
    await expect(page.getByText("Still open — carries to tomorrow")).toHaveCount(0);
  });

  test("settles the stations, dismisses a leftover, and records the close", async ({
    page,
    request,
  }) => {
    // A full evening's work over a nine-diver day: the seed, then several
    // server round trips.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    // Every station of the day has settled, so the closing block is there —
    // the leftovers first, then the one act, with the spine's own Tomorrow
    // disclosure closing the page behind it.
    await expect(page.getByText("Still open — carries to tomorrow")).toBeVisible();

    // **No acknowledgement gate.** The old surface put a checkbox in front of
    // this act; H-57 already has the shop deciding each leftover as it meets
    // one, so nothing re-asks at the close.
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    // H-57's per-row decision: dismissed immediately, with Undo — never a
    // confirm in front of something reversible.
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

    // The one closing act.
    await page
      .getByRole("button", { name: /^Close the day( again)?$/ })
      .first()
      .click();
    await expect(page.getByText("Day closed. The record is below")).toBeVisible();
    await expect(page.getByText(/Closed by Dana Reyes at/)).toBeVisible();

    // A closed day is a record, never a lock: the act is still there, and
    // closing again appends rather than edits.
    await page.getByRole("button", { name: "Close the day again" }).click();
    await expect(page.getByText(/Closed \d+ times today/)).toBeVisible();
  });

  test("names divers and crew in the homecoming line once every count has closed", async ({
    page,
    request,
  }) => {
    // **Souls, not seats** (issue #1346). The line counted bookings until
    // 2026-09-05, which left the crew — the people most reliably still in the
    // water at the end of a day — out of both numbers on the one sentence
    // about who came home. The `?heads=closed` fixture is the only way to
    // reach the moment, because `assembleEveningClose` refuses to claim it
    // over a boat nobody counted.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    expect((await request.post("/api/test/seed-evening?heads=closed")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    await expect(
      page.getByText(/^All boats are home: \d+ divers and \d+ crew out, \d+ back\.$/),
    ).toBeVisible();
  });

  test("closes the day on the crew's own word, an hour before the clock would", async ({
    page,
    request,
  }) => {
    // **Issue #1480, end to end.** The late-arrival hour is an allowance for a
    // *time-based inference* about a boat nobody has heard from. A crew member
    // tapping Home at the rail is not an inference — it is the statement the
    // buffer was standing in for — so the day may close on it.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    const seeded = await request.post("/api/test/seed-evening?heads=closed&last=just-in");
    expect(seeded.ok()).toBe(true);
    const { departures } = (await seeded.json()) as { departures: { id: string }[] };
    const justIn = departures.at(-1);
    if (!justIn) throw new Error("the evening fixture moved no departures");

    // Every count is closed and every earlier boat is home, but the last one
    // tied up five minutes ago — so the clock still says she is out, and
    // nothing on the page offers to close a day she is on.
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Close the day/ })).toHaveCount(0);

    await page.goto(`/shop/blue-mantis/trips/${justIn.id}/manifest`);
    await offlineCopySaved(page);
    const home = page.getByRole("button", { name: "Home", exact: true });
    await home.click();
    // The strip's own pressed state is what the server sent back, so it is the
    // wait for the write rather than an optimistic paint — the same reading
    // e2e/boat-stage.spec.ts makes of this control.
    await expect(home).toHaveAttribute("aria-pressed", "true");

    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("button", { name: /^Close the day/ })).toBeVisible();
    await expect(
      page.getByText(/^All boats are home: \d+ divers and \d+ crew out, \d+ back\.$/),
    ).toBeVisible();
  });

  test("keeps the size a unit came home in, and takes the question off the page", async ({
    page,
    request,
  }) => {
    // The evening's rental-fit leftover (issue #1174, D14). The desk already
    // confirmed the swap at the counter, so the row asks one question and its
    // answer is the tap itself.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    const keep = page.getByRole("button", { name: "Keep it" });
    await expect(keep).toBeVisible();
    await keep.click();

    // The row leaving the leftovers group is the whole answer (#1400). There
    // used to be a "Fit saved." banner here; on an evening with three of these
    // rows it said the same sentence twice and named neither diver. This
    // retrying assertion is now the wait for the write to land — the positive
    // query for the same button is four lines above.
    await expect(page.getByRole("button", { name: "Keep it" })).toHaveCount(0);
  });

  test("308s the old close-out URL home, carrying its notice with it", async ({ page }) => {
    // The route folded (H-62). Every link already out in the world — a
    // bookmark, an old chat message, the departure log's own owner-only
    // refusal — still lands somewhere that can answer it.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/close-out?notice=log-not-authorized");
    // Matched without the `?notice=`, deliberately — the same reasoning
    // e2e/departure-log.spec.ts spells out. `FlashParams` strips it in a
    // `useEffect` the moment the page hydrates, so asserting on the query
    // string is a race with hydration. What is durable is the destination and
    // the banner a staffer actually reads.
    await page.waitForURL(/\/shop\/blue-mantis(\?|$)/);
    await expect(page.getByText(/[Oo]nly an owner can generate/)).toBeVisible();
  });

  test("answers the phrase in the palette with a command rather than a place", async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/orders");

    // Close-out is not a destination any more, so it is not in the dock or the
    // header — but a staffer who has typed "close the day" for a year still
    // gets an answer.
    await expect(page.getByRole("link", { name: "Close-out" })).toHaveCount(0);
    await page.getByRole("button", { name: "Search" }).click();
    const box = page.getByRole("combobox", { name: /Search divers/ });
    await box.fill("close the day");
    await page.getByRole("option", { name: "Close the day", exact: true }).click();
    await page.waitForURL(/\/shop\/blue-mantis(#close-day)?$/);
  });

  /**
   * **What today made, and who may read it** (issue #1930).
   *
   * The evening gained one money reading, above the closing block and inside
   * nothing. The half worth an end-to-end test is the gate: `/shop/**` is one
   * shell and the evening is the same composition for every staff role, so
   * the only thing between a captain and the shop's takings is
   * `canPersonViewShopReports` resolved on the server. A component test can
   * assert only that the spine renders what the page handed it.
   *
   * Two tests rather than one signed-out-and-in-again: a fresh context per
   * test is what Playwright already gives, and a failure then names the role
   * it happened to.
   */
  test("reads the day's takings to an owner", async ({ page, request }) => {
    // A seed write, then a signed-in evening render.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    const takings = page.getByRole("region", { name: "What today made" });
    await expect(takings).toBeVisible();
    // A money figure inside that region, not merely its words. The seeded day
    // sells seats, so this is a real number rather than a formatted zero — the
    // amount itself stays out of the assertion, because the demo's prices are
    // the demo's to change.
    await expect(takings.getByText(/^\$[\d,]+$/)).toBeVisible();
    // Above the act, which is the whole of the placement decision (Aaron,
    // 2026-09-20, on #1930): the closing block still shows two things.
    await expect(page.locator("#close-day")).not.toContainText("What today made");
  });

  test("withholds the day's takings from a captain", async ({ page, request }) => {
    // A seed write, then a signed-in evening render.
    test.setTimeout(45_000);
    await signInAs(page, DEV_STAFF_LOGINS.captain);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    // The closing act is the positive query that proves this page rendered an
    // evening at all — without it the absence below would pass on a redirect,
    // an error, or a morning.
    await expect(page.getByRole("button", { name: /^Close the day/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "What today made" })).toHaveCount(0);
    // And nothing stands in its place saying a number is being withheld: that
    // would tell the crew precisely what the gate exists not to tell them.
    await expect(page.getByText(/in tips/)).toHaveCount(0);
  });
});
