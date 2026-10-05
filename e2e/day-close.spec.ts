import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { offlineCopySaved, STAFF_DAY_HEADING, signInAs, signInAsOwner } from "./helpers";

/**
 * **The evening, on the shop home** — ADR 20260827-clearwater-surface-language,
 * decision 4.
 *
 * The stations of the home's spine settle one by one as head counts close, and
 * the day's takings appear beneath them once every departure of the shop day
 * has ended, with the standing one-hour buffer. There is nothing to press to
 * end the day: the "Close the day" act was removed on 2026-10-05, because
 * nothing ever read the record it wrote.
 *
 * The seeded demo day is deliberately mid-morning, which is exactly what the
 * first test needs and exactly what the second cannot use. `seed-evening`
 * moves the day's departures behind the frozen clock instead of moving the
 * clock, which is process-wide (`e2e/servers.ts`).
 */
test.describe("the evening on the home", () => {
  test("holds the takings back while a boat is still out", async ({ page }) => {
    // The pin, end to end. At the fleet's frozen 09:30 shop-local the demo has
    // a first-light boat home and a later one still on the water — so the
    // settled station is there with its own reading, and nothing on the page
    // reads the day as over.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();

    await expect(page.getByRole("region", { name: "What today made" })).toHaveCount(0);
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

  test("settles the day on the crew's own word, an hour before the clock would", async ({
    page,
    request,
  }) => {
    // **Issue #1480, end to end.** The late-arrival hour is an allowance for a
    // *time-based inference* about a boat nobody has heard from. A crew member
    // tapping Home at the rail is not an inference — it is the statement the
    // buffer was standing in for — so the day may settle on it.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    const seeded = await request.post("/api/test/seed-evening?heads=closed&last=just-in");
    expect(seeded.ok()).toBe(true);
    const { departures } = (await seeded.json()) as { departures: { id: string }[] };
    const justIn = departures.at(-1);
    if (!justIn) throw new Error("the evening fixture moved no departures");

    // Every count is closed and every earlier boat is home, but the last one
    // tied up five minutes ago — so the clock still says she is out, and
    // nothing on the page reads the day as over.
    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
    await expect(page.getByRole("region", { name: "What today made" })).toHaveCount(0);

    await page.goto(`/shop/blue-mantis/trips/${justIn.id}/manifest`);
    await offlineCopySaved(page);
    const home = page.getByRole("button", { name: "Home", exact: true });
    await home.click();
    // The strip's own pressed state is what the server sent back, so it is the
    // wait for the write rather than an optimistic paint — the same reading
    // e2e/boat-stage.spec.ts makes of this control.
    await expect(home).toHaveAttribute("aria-pressed", "true");

    await page.goto("/shop/blue-mantis");
    await expect(page.getByRole("region", { name: "What today made" })).toBeVisible();
    await expect(
      page.getByText(/^All boats are home: \d+ divers and \d+ crew out, \d+ back\.$/),
    ).toBeVisible();
  });

  test("keeps the size a unit came home in, and takes the question off the page", async ({
    page,
    request,
  }) => {
    // The evening's rental-fit row in Needs you (issue #1174, D14). The desk already
    // confirmed the swap at the counter, so the row asks one question and its
    // answer is the tap itself.
    test.setTimeout(45_000);
    await signInAsOwner(page);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    const keep = page.getByRole("button", { name: "Keep it" });
    await expect(keep).toBeVisible();
    await keep.click();

    // The row leaving Needs you is the whole answer (#1400). There
    // used to be a "Fit saved." banner here; on an evening with three of these
    // rows it said the same sentence twice and named neither diver. This
    // retrying assertion is now the wait for the write to land — the positive
    // query for the same button is four lines above.
    await expect(page.getByRole("button", { name: "Keep it" })).toHaveCount(0);
  });

  /**
   * **What today made, and who may read it** (issue #1930).
   *
   * The evening has one money reading, beneath the stations and inside
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
    // Nothing to press: the day is over when the boats are home.
    await expect(page.getByRole("button", { name: /^Close the day/ })).toHaveCount(0);
  });

  test("withholds the day's takings from a captain", async ({ page, request }) => {
    // A seed write, then a signed-in evening render.
    test.setTimeout(45_000);
    await signInAs(page, DEV_STAFF_LOGINS.captain);
    expect((await request.post("/api/test/seed-evening")).ok()).toBe(true);
    await page.goto("/shop/blue-mantis");

    // A returned boat's recap line is the positive query that proves this page
    // rendered an evening at all — without it the absence below would pass on
    // a redirect, an error, or a morning.
    await expect(page.getByText(/^This recap /).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "What today made" })).toHaveCount(0);
    // And nothing stands in its place saying a number is being withheld: that
    // would tell the crew precisely what the gate exists not to tell them.
    await expect(page.getByText(/in tips/)).toHaveCount(0);
  });
});
