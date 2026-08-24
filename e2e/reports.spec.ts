import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * READ_ONLY holds here: the monthly report is a read of trips that already sailed, and
 * the month picker is a GET form. Nothing on this surface writes.
 */

// Owner reporting (ADR 20260723-owner-reporting): "how's my month" over data the
// shop already has — bookings, revenue, seat fill, waiver completion — anchored
// to the trips that sailed, with month-to-month navigation. Owner/manager only.

test.describe("owner", () => {
  signedInAsOwner();

  test("shows this month's headline numbers and a per-trip breakdown", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reports");

    await expect(page.getByRole("heading", { level: 1, name: "How's your month" })).toBeVisible();

    // The four headline metrics the buyer asks about.
    const metrics = page.getByRole("region", { name: "This month's numbers" });
    await expect(metrics.getByText("Net revenue")).toBeVisible();
    await expect(metrics.getByText("Bookings")).toBeVisible();
    await expect(metrics.getByText("Seat fill")).toBeVisible();
    await expect(metrics.getByText("Waivers signed")).toBeVisible();

    // The seeded back-fill means the current month always has trips to show.
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });

  test("pages back to a fully-realized prior month", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/reports\?month=\d{4}-\d{2}/);
    // A month that has fully sailed still renders its numbers and its trips.
    await expect(page.getByRole("region", { name: "This month's numbers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });

  test("the month picker jumps straight to a far month", { tag: READ_ONLY }, async ({ page }) => {
    // The arrows are one month per click, so reaching last spring used to be a
    // dozen page loads. One GET form, one month.
    await page.goto("/shop/blue-mantis/reports");
    await page.getByLabel("Jump to a month").fill("2026-03");
    await page.getByRole("button", { name: "Go" }).click();

    await expect(page).toHaveURL(/reports\?month=2026-03$/);
    await expect(page.getByRole("heading", { level: 2, name: "March 2026" })).toBeVisible();
    await expect(page.getByRole("region", { name: "This month's numbers" })).toBeVisible();
  });

  test("a month before the shop's first departure is clamped, not rendered as the year 1", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // `?month=` is hand-editable and bookmarkable. The page clamps to the same
    // floor the picker's `min` offers, so a nonsense month lands somewhere real.
    await page.goto("/shop/blue-mantis/reports?month=0001-01");
    const heading = page.getByRole("heading", { level: 2 }).first();
    await expect(heading).toHaveText(/\b20\d{2}\b/);
    // Landed at the floor, so there is nothing further back to walk to.
    await expect(page.getByRole("link", { name: "Previous month" })).toHaveCount(0);
  });

  /**
   * Issue #700 — a baseline beside each headline, not five numbers with
   * nothing to compare them to. blue-mantis's seeded back-fill spans several
   * months, so the current month always has *some* prior month behind it
   * (the "pages back to a fully-realized prior month" test above already
   * relies on the same fact) — which month it resolves to (year-ago or the
   * labelled previous-month fallback) is not pinned here, only that a real
   * comparison renders.
   */
  test("a headline card compares against a baseline month, not just this one", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    const metrics = page.getByRole("region", { name: "This month's numbers" });
    // "vs $X in <Month> <Year>", with or without a leading percent/points
    // trend — see reports.comparison.yearAgo / previousMonthFallback.
    await expect(metrics.getByText(/vs .+ in \w+ \d{4}/).first()).toBeVisible();
  });

  test("the shop's very first reportable month has no baseline to compare against", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // The same floor the month picker itself clamps to (see the "clamped, not
    // rendered as the year 1" test) — nothing precedes it, so nothing can back
    // a comparison, and the absence must stay absent rather than a manufactured
    // "0%" or "—".
    await page.goto("/shop/blue-mantis/reports?month=0001-01");
    await expect(page.getByRole("link", { name: "Previous month" })).toHaveCount(0);
    const metrics = page.getByRole("region", { name: "This month's numbers" });
    await expect(metrics.getByText(/vs .+ in \w+ \d{4}/)).toHaveCount(0);
  });

  test("the trip table names how much crew each departure carried", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // Never a cost — DiveDay does not know wages — just the headcount beside
    // the fill a bare percentage alone cannot show (issue #700).
    await page.goto("/shop/blue-mantis/reports");
    const table = page.getByRole("region", { name: "Trips this month" });
    await expect(table.getByRole("columnheader", { name: "Crew" })).toBeVisible();
  });

  test("downloads this month's report as a CSV, distinct from the full-shop export", {
    tag: READ_ONLY,
  }, async ({ page, request }) => {
    await page.goto("/shop/blue-mantis/reports");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^diveday-report-blue-mantis-\d{4}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const response = await request.get("/shop/blue-mantis/reports/download");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
    const body = await response.text();
    expect(body).toContain("Net revenue");
    expect(body).toContain("Crew assigned");
  });

  test("the month and its numbers lead the page, above the per-trip table", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // The page reads top-down as the question it answers: which month, then how
    // it went, then the trips behind those figures. The compliance panels that
    // used to sit above all three now come last — not asserted here, because
    // the demo shop owes none and an "if any exist" loop over an empty set is a
    // test that passes without observing anything (their placement is a
    // baseline concern for a shop that does; see the page's own comment).
    await page.goto("/shop/blue-mantis/reports");
    const chooser = page.getByRole("navigation", { name: "Choose month" });
    const numbers = page.getByRole("region", { name: "This month's numbers" });
    const table = page.getByRole("region", { name: "Trips this month" });
    await expect(table).toBeVisible();

    const [chooserY, numbersY, tableY] = await Promise.all(
      [chooser, numbers, table].map(async (locator) => (await locator.boundingBox())?.y ?? -1),
    );
    expect(chooserY).toBeGreaterThan(0);
    expect(numbersY).toBeGreaterThan(chooserY);
    expect(tableY).toBeGreaterThan(numbersY);
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("reports are gated to the owner or manager, not the daily crew", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reports");
    // The captain has no use for revenue, so the surface doesn't exist for
    // them — bounced to Today rather than shown a read-only/explained page.
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
    await expect(page.getByRole("region", { name: "This month's numbers" })).toHaveCount(0);
  });
});
