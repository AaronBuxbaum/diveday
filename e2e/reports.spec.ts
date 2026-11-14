import { staffTranslator } from "../src/i18n/staff-messages";
import { formatMoneyCents } from "../src/lib/format";
import { parseCsv } from "../src/lib/import";
import { majorToMinor } from "../src/lib/money";
import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * READ_ONLY holds here: the monthly report is a read of trips that already sailed, and
 * the month arrows are plain links. Nothing on this surface writes.
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

    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();

    // The six headline figures the buyer asks about — unboxed since slice 9f
    // of ADR 20260827-the-shops-shelves, which is why these are exact matches:
    // "Seats" is a figure's own label, and the rows below it say "9 of 12
    // seats" without being one.
    const metrics = page.getByRole("region", { name: "This month’s numbers" });
    await expect(metrics.getByText("Net revenue", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Billed", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Collected", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Tips", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Seats", { exact: true })).toBeVisible();
    await expect(metrics.getByText("Fill", { exact: true })).toBeVisible();

    // Two "this month" totals on one page say which month each one means
    // (third review, item 1): the headline by departure, the by-line table by
    // the day the money was paid.
    await expect(
      page.getByText("Paid this month, whichever departure it was for, after tax and refunds"),
    ).toBeVisible();

    // The tax figure is a footnote to net revenue now, not a sixth tile beside
    // it; the month's files are in the header's Export menu.
    await expect(page.getByText(/Tax collected/)).toBeVisible();

    // The seeded back-fill means the current month always has trips to show.
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });

  test("pages back to a fully-realized prior month", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/reports");
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/reports\?month=\d{4}-\d{2}/);
    // A month that has fully sailed still renders its numbers and its trips.
    await expect(page.getByRole("region", { name: "This month’s numbers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Trips this month" })).toBeVisible();
  });

  test("the visible tip pool reconciles with the crew export's shares", {
    tag: READ_ONLY,
  }, async ({ page, request }) => {
    const month = E2E_FROZEN_CLOCK.slice(0, 7);
    const response = await request.get(
      `/shop/blue-mantis/settings/export/crew-sheet?month=${month}`,
    );
    expect(response.status()).toBe(200);
    const shares = parseCsv(await response.text())
      .slice(1)
      .filter((row) => Number(row[4]) > 0)
      .map((row) => ({
        name: row[0] ?? "",
        cents: majorToMinor(Number(row[4]), row[5] ?? "usd"),
        currency: row[5] ?? "usd",
      }));
    expect(shares.length).toBeGreaterThan(0);
    expect(shares.every((share) => share.currency === "USD")).toBe(true);

    await page.goto(`/shop/blue-mantis/reports?month=${month}`);
    const t = staffTranslator("en-US");
    const metrics = page.getByRole("region", { name: t("reports.numbersLabel") });
    // The shares themselves are the crew sheet's (visual review A06: a tile
    // is one number); the pool on the tile is their sum to the cent (#2858).
    const poolCents = shares.reduce((sum, share) => sum + share.cents, 0);
    await expect(
      metrics.getByText(formatMoneyCents(poolCents, "usd", "en-US"), { exact: true }),
    ).toBeVisible();
  });

  test("the month sits between its arrows, which are the only way to change it", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // UX review 2026-10-10, item 32: arrows alone, the period between them.
    await page.goto("/shop/blue-mantis/reports?month=2026-03");
    const nav = page.getByRole("navigation", { name: "Choose month" });
    await expect(nav.getByRole("heading", { level: 2, name: "March 2026" })).toBeVisible();
    await expect(nav.getByRole("combobox")).toHaveCount(0);
    await nav.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/reports\?month=2026-04$/);
    await expect(page.getByRole("heading", { level: 2, name: "April 2026" })).toBeVisible();
  });

  test("a month before the shop's first departure is clamped, not rendered as the year 1", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // `?month=` is hand-editable and bookmarkable. The page clamps to the same
    // floor the back arrow stops at, so a nonsense month lands somewhere real.
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
    const metrics = page.getByRole("region", { name: "This month’s numbers" });
    // "vs $X in <Month> <Year>", with or without a leading percent/points
    // trend — see reports.comparison.yearAgo / previousMonthFallback.
    await expect(metrics.getByText(/vs .+ in \w+ \d{4}/).first()).toBeVisible();
  });

  test("the shop's very first reportable month has no baseline to compare against", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // The same floor the back arrow stops at (see the "clamped, not
    // rendered as the year 1" test) — nothing precedes it, so nothing can back
    // a comparison, and the absence must stay absent rather than a manufactured
    // "0%" or "—".
    await page.goto("/shop/blue-mantis/reports?month=0001-01");
    await expect(page.getByRole("link", { name: "Previous month" })).toHaveCount(0);
    const metrics = page.getByRole("region", { name: "This month’s numbers" });
    await expect(metrics.getByText(/vs .+ in \w+ \d{4}/)).toHaveCount(0);
  });

  test("every departure row names its own seats, crew and waivers", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // Crew is never a cost — DiveDay does not know wages — just the headcount
    // beside the fill a bare percentage alone cannot show (issue #700).
    //
    // The column headers that used to name these three facts went with the
    // table (slice 9f): a ledger row has nothing above it to borrow a noun
    // from, so each fact carries its own — which is also what let the phone
    // stop hiding two of them behind a breakpoint.
    await page.goto("/shop/blue-mantis/reports");
    const ledger = page.getByRole("region", { name: "Trips this month" });
    await expect(ledger.getByText(/\d+ of \d+ seats?$/).first()).toBeVisible();
    await expect(ledger.getByText(/^\d+ crew$/).first()).toBeVisible();
    await expect(
      ledger.getByText(/^(All waivers in|\d+ waivers? to collect)$/).first(),
    ).toBeVisible();
  });

  test("departure money and waiver facts meet the critical-text floor", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reports");
    const ledger = page.getByRole("region", { name: "Trips this month" });
    const money = ledger.getByText(/^\$[\d,.]+$/).first();
    const waiver = ledger.getByText(/^(All waivers in|\d+ waivers? to collect)$/).first();
    await expect(money).toBeVisible();
    await expect(waiver).toBeVisible();
    for (const fact of [money, waiver]) {
      expect(
        await fact.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
  });

  test(
    "long departure facts wrap without losing the row door",
    { tag: READ_ONLY },
    async ({ page }, testInfo) => {
      // Stress the real row geometry with values longer than the demo data. This
      // changes only text in the browser, not report arithmetic or waiver state.
      for (const locale of ["en-US", "es-ES"] as const) {
        await page.goto("/shop/blue-mantis/reports");
        await page
          .context()
          .addCookies([{ name: "diveday_locale", value: locale, url: page.url() }]);
        await page.reload();
        const copy = staffTranslator(locale);
        // The shell's hydration probe can finish before this streamed report.
        // Prove its own React boundary is active before changing server text:
        // otherwise late hydration replaces the stressed row with the seed.
        const exportMenu = page.getByRole("button", { name: copy("reports.export"), exact: true });
        await exportMenu.click();
        await expect(exportMenu).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(exportMenu).toHaveAttribute("aria-expanded", "false");
        const ledger = page.getByRole("region", { name: copy("reports.tripsThisMonth") });
        const outstanding = ledger
          .getByText(copy("reports.row.waiversToCollect", { count: 1 }), { exact: true })
          .first();
        await expect(outstanding).toBeVisible();
        await outstanding.locator("xpath=ancestor::li").evaluate((node) => {
          node.setAttribute("data-stress-row", "");
        });
        const row = ledger.locator("[data-stress-row]");
        const waiver = row.locator("span.text-warning-strong");
        const money = row.locator("span.text-foreground").first();
        await expect(money).toBeVisible();
        await waiver.evaluate(
          (node, text) => {
            node.textContent = text;
          },
          copy("reports.row.waiversToCollect", { count: 12 }),
        );
        await money.evaluate(
          (node, text) => {
            node.textContent = text;
          },
          locale === "es-ES" ? "1.234.567,89 US$" : "$1,234,567.89",
        );
        await expect(waiver).toHaveText(copy("reports.row.waiversToCollect", { count: 12 }));
        for (const width of [390, 1280, 640]) {
          // 640 CSS pixels represents the desktop's 1280px viewport at 200% zoom.
          await page.setViewportSize({ width, height: 844 });
          for (const fact of [money, waiver]) {
            const fits = await fact.evaluate((node) => {
              const box = node.getBoundingClientRect();
              return (
                box.left >= 0 &&
                box.right <= document.documentElement.clientWidth &&
                node.scrollWidth <= node.clientWidth
              );
            });
            expect(fits, `${locale} ${width}px fact stays within its column and viewport`).toBe(
              true,
            );
          }
          await expect(row.getByRole("link").first()).toHaveAttribute("href", /\/trips\//);
          await row.scrollIntoViewIfNeeded();
          await page.evaluate(() => window.scrollBy(0, 300));
          await row.screenshot({ path: testInfo.outputPath(`ledger-${locale}-${width}.png`) });
        }
      }
    },
  );

  test("downloads this month's report as a CSV, distinct from the full-shop export", {
    tag: READ_ONLY,
  }, async ({ page, request }) => {
    await page.goto("/shop/blue-mantis/reports");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^diveday-report-blue-mantis-\d{4}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const response = await request.get("/shop/blue-mantis/reports/download");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/csv/);
    const body = await response.text();
    // One tidy table, not three stacked under three headers (third UX review,
    // item 34): one header row, then one fact per row.
    const [header, ...rows] = body.trimEnd().split("\r\n");
    expect(header).toBe("Section,Item,Date,Measure,Value");
    expect(rows).not.toContain(header);
    expect(body).toContain("Summary,,,Net revenue,");
    expect(body).toContain(",Crew assigned,");
    // The page's "Money in, by line", from the same query (issue #2305).
    expect(body).toContain('"Money in, by line",');
  });

  test("the month and year actions follow the selected report", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/reports?month=2026-03");
    const monthCard = page.getByRole("link", { name: "Print the card" });
    await expect(monthCard).toHaveAttribute("href", "/shop/blue-mantis/reports/card?month=2026-03");
    expect(
      (await request.get("/shop/blue-mantis/reports/card?month=2026-03")).headers()["content-type"],
    ).toMatch(/^image\/png/);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/reports/download?month=2026-03",
    );

    await page.goto("/shop/blue-mantis/reports?range=year&year=2026");
    await expect(page.getByRole("link", { name: "Print the card" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/reports/card?year=2026",
    );
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/reports/download?year=2026",
    );
    await expect(page.getByRole("link", { name: "Download the year (CSV)" })).toHaveCount(0);
  });

  test("the month and its numbers lead the page, above the departures ledger", {
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
    const numbers = page.getByRole("region", { name: "This month’s numbers" });
    const ledger = page.getByRole("region", { name: "Trips this month" });
    await expect(ledger).toBeVisible();

    const [chooserY, numbersY, tableY] = await Promise.all(
      [chooser, numbers, ledger].map(async (locator) => (await locator.boundingBox())?.y ?? -1),
    );
    expect(chooserY).toBeGreaterThan(0);
    expect(numbersY).toBeGreaterThan(chooserY);
    expect(tableY).toBeGreaterThan(numbersY);
  });
});

test.describe("owner, the Safety page", () => {
  signedInAsOwner();

  // The month's safety record (ADR 20261012-incident-reports): the figures and
  // the roll calls left open, read from what the shop already records.
  test("shows the month's safety figures and the roll calls left open", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/safety");

    // All four counts remain visible; a figure only links to a list that exists.
    const record = page.getByRole("region", { name: "This month’s safety record" });
    await expect(record).toBeVisible();
    await expect(record.locator("dt")).toHaveCount(4);
    await expect(record.locator('a[href*="/settings/activity"]')).toHaveCount(1);
    const listLinks = record.locator('a[href^="#"]');
    for (let index = 0; index < (await listLinks.count()); index += 1) {
      const href = await listLinks.nth(index).getAttribute("href");
      expect(href).toBeTruthy();
      await expect(page.locator(href as string)).toBeVisible();
    }

    // The Print door opens the month as a sheet of the shop's paper, with the
    // same four counts and no control on it.
    await page.getByRole("link", { name: "Print month" }).click();
    await expect(page).toHaveURL(/\/safety\/print\?month=\d{4}-\d{2}/);
    const sheet = page.locator(".paper-sheet");
    await expect(sheet.getByRole("region", { name: "This month’s safety record" })).toBeVisible();
    await expect(sheet.getByRole("link")).toHaveCount(0);
    await expect(sheet.getByRole("button")).toHaveCount(0);
    await page.goto("/shop/blue-mantis/safety");
    await page.getByRole("link", { name: "Year", exact: true }).click();
    await expect(page).toHaveURL(/\/safety\?year=\d{4}/);
    await expect(page.getByRole("link", { name: "Print the year" })).toBeVisible();
    await page.getByRole("link", { name: "Month", exact: true }).click();
    await expect(page).toHaveURL(/\/safety\?month=\d{4}-\d{2}/);
    const chooser = page.getByRole("navigation", { name: "Choose month" });
    await chooser.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/\/safety\?month=\d{4}-\d{2}/);
    // Safety is a place of its own (not a Money tab) and wears its own name.
    // The manager's way in is pinned in safety/page.test.tsx; the demo shop has
    // no manager login to sign in with here.
    await expect(page.getByRole("heading", { level: 1, name: "Safety" })).toBeVisible();
  });
});

test.describe("owner, Safety's tabs", () => {
  signedInAsOwner();

  // Drills sits beside the month's record as a tab of Safety and draws one tile
  // per kind of drill with the days since it was run. Waivers are not here:
  // setup is in Settings, signatures are read in Divers (Aaron, 2026-11-13).
  test("moves between Overview and Drills, with four drill tiles", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/safety");
    const tabs = page.getByRole("navigation", { name: "Safety" });
    await tabs.getByRole("link", { name: "Drills" }).click();
    await expect(page).toHaveURL(/\/safety\/drills/);
    await expect(page.getByRole("heading", { level: 1, name: "Safety" })).toBeVisible();
    for (const kind of ["Emergency oxygen", "Missing diver", "Person overboard", "Fire"]) {
      await expect(page.getByText(kind, { exact: true }).first()).toBeVisible();
    }
    await expect(tabs.getByRole("link", { name: "Waivers" })).toHaveCount(0);
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
    await expect(page.getByRole("region", { name: "This month’s numbers" })).toHaveCount(0);
  });

  test("the Safety page is gated the same way", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/safety");
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
    await expect(page.getByRole("region", { name: "This month’s safety record" })).toHaveCount(0);
  });
});
