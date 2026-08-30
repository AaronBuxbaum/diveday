import type { Page } from "@playwright/test";
import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * READ_ONLY holds here: every one of these reads the orders index, its toolbar and its
 * pager, or a refusal page. The Stripe-calling controls are asserted *disabled*, and the
 * toolbar is a GET form — a navigation, not a write.
 */

/**
 * Every row of the day ledger (ADR 20260827-clearwater-surface-language, slice
 * 6f). Rows sit in a `<ul>` under each day's own `<h2>`, directly on the page
 * background — there is no table here any more, and no date column either: the
 * day header owns the date for every row beneath it.
 */
const ledgerRows = (page: Page) =>
  page.locator('ul[aria-labelledby^="orders-day-"] > li').filter({ visible: true });

/** Each day group's heading, in ledger order — newest day first. */
const dayHeadings = (page: Page) => page.locator('h2[id^="orders-day-"]');

/** The toolbar's count, which is where the whole filtered total is stated now. */
const orderCount = (page: Page) => page.getByText(/^\d+ orders?$/);

// The seeded demo carries a billing history whose orders have fabricated Stripe
// ids (the demo never connects an account). The Stripe-calling controls —
// Refresh/Void/Refund on the order page, which is where money out lives since
// ADR 20260827-people-not-lists took it off the diver record — are disabled on
// a demo shop with a hover reason, and the actions refuse before any Stripe
// call (ADR 20260723-owner-reporting; src/db/seed.ts).

test.describe("demo billing history", () => {
  signedInAsOwner();

  test("a paid demo order's refund control is disabled with a reason", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // **The diver record no longer holds a refund at all** — money out is the
    // Orders ledger's act, where the form can send back a partial amount (ADR
    // 20260827-people-not-lists). A seeded historical diver with a paid order
    // on file, reached the way a staffer reaches one: through the order.
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page.getByRole("link", { name: "Grace Halloran", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0);

    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    await ledgerRows(page).first().getByRole("link").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
    const orderRefund = page.getByRole("button", { name: /Refund|Void|Refresh/ }).first();
    await expect(orderRefund).toBeDisabled();
    await expect(page.getByText(/backed by a live Stripe invoice/i)).toBeVisible();
  });

  test("an order opened from the index says when it was raised and offers both ways back", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // Arriving from the index (not from a diver) used to leave browser-back as
    // the only exit, and the date the index showed disappeared on the way in —
    // on the one screen a refund argument turns on.
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    // The date is the *group's* now, not the row's, which is the whole point of
    // the ledger — so this is where it has to be read from. Today's group wears
    // it after a "Today · " prefix; every other day is the bare date.
    const heading = ((await dayHeadings(page).first().textContent()) ?? "").trim();
    const rowDate = (heading.split("·").pop() ?? "").trim();
    await ledgerRows(page).first().getByRole("link").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);

    // The same day the group showed, plus who raised it.
    await expect(page.getByText(`Raised ${rowDate}`)).toBeVisible();
    await expect(page.getByText(/Raised .+ · by .+/)).toBeVisible();

    // Both journeys home, neither of them the browser's back button.
    await expect(page.getByRole("link", { name: "Back to diver" })).toBeVisible();
    await page.getByRole("link", { name: "Back to orders" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
  });

  /**
   * The index is paged (`ORDER_PAGE_SIZE`). Before that it rendered every one
   * of the demo's 323 orders in a single ~17,700px scroll — the whole table
   * queried and painted on every visit, for a screen nobody reads past the
   * first few rows of.
   */
  test("the order index pages instead of rendering every order", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();

    const rows = ledgerRows(page);
    await expect(rows.first()).toBeVisible();
    const firstPageCount = await rows.count();
    expect(firstPageCount).toBeLessThanOrEqual(50);
    // The row's own door, by destination rather than by text: a ledger row's
    // link is the stretched overlay, whose only text is its accessible name,
    // and an order id is unique where a diver-and-amount label need not be.
    const firstOrder = rows.first().getByRole("link").first();
    const firstHref = await firstOrder.getAttribute("href");
    if (!firstHref) {
      throw new Error("First order row is missing its destination.");
    }

    // The toolbar states the whole set, not just what is on screen.
    await expect(orderCount(page)).toBeVisible();
    const pager = page.getByRole("navigation", { name: "Pages" });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText(/Page 1 of \d+/);

    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/[?&]page=2/);
    await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
    // Different orders, not the same screen re-rendered.
    await expect(rows.first().getByRole("link").first()).not.toHaveAttribute("href", firstHref);

    // And back, without losing the pager.
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("link", { name: "Previous" })
      .click();
    await expect(rows.first().getByRole("link").first()).toHaveAttribute("href", firstHref);
  });

  /**
   * The index used to load every order a shop had ever raised. It opens on a
   * safe window now, with the range choice in the filter form and an explicit
   * all-orders option for a staffer hunting an older order.
   */
  test("the index opens on a safe default range with an explicit all-orders option", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    // Apply-on-change means the select is the submit, so nothing may be
    // selected until the handler is live — the toolbar says when it is.
    await page.locator('#orders-search[data-hydrated="true"]').waitFor();
    const range = page.getByLabel("Date range");
    await expect(range).toHaveValue("recent");

    const windowed = await ledgerRows(page).count();
    const windowedTotal = await orderCount(page).textContent();

    await range.selectOption("all");
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByLabel("Date range")).toHaveValue("all");
    // A strictly larger set — otherwise the window was never doing anything,
    // and this test would pass on a page that silently ignores `?range=`.
    const allTotal = await orderCount(page).textContent();
    expect(allTotal).not.toBe(windowedTotal);
    expect(await ledgerRows(page).count()).toBeGreaterThanOrEqual(windowed);

    // And back to the safe default, so the range control is not one-way.
    await page.getByLabel("Date range").selectOption("recent");
    await expect(page).toHaveURL(/range=recent/);
    await expect(page.getByLabel("Date range")).toHaveValue("recent");
  });

  /**
   * The rule the whole recomposition turns on (ADR
   * 20260827-clearwater-surface-language, decision 7): the day header owns the
   * date, so no row under it may print one. The unit tests pin the view model;
   * this pins the rendered page, where a stray date column would actually show.
   */
  test("no row repeats its day group's date", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    await expect(ledgerRows(page).first()).toBeVisible();

    const heading = ((await dayHeadings(page).first().textContent()) ?? "").trim();
    const date = (heading.split("·").pop() ?? "").trim();
    expect(date).not.toBe("");

    await expect(dayHeadings(page).first()).toContainText(date);
    const firstDayRows = page.locator('ul[aria-labelledby^="orders-day-"]').first().locator("> li");
    // The loop asserts an absence, so an empty day group would pass it without
    // reading a single row.
    await expect(firstDayRows.filter({ visible: true })).not.toHaveCount(0);
    for (const row of await firstDayRows.filter({ visible: true }).all()) {
      await expect(row).not.toContainText(date);
    }
  });

  test("an exceptional status wears the row's one pill", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=open&range=all");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();

    const row = ledgerRows(page)
      // The ledger reads the canonical status word, not the order *detail*
      // page's "Open — awaiting payment": that gloss is a sentence for a page
      // with room for one, and on a row it is three words wrapping inside a
      // pill. `exact` because "Open" is a substring of half the words here.
      .filter({ has: page.getByText("Open", { exact: true }) })
      .first();
    await expect(row).toBeVisible();
    // `Badge` is the page's only pill (decision 3), so one pill on the row is
    // the whole assertion — and its word is beside the amount, not in a
    // column of its own that every settled row leaves blank.
    await expect(row.locator("span.rounded-full")).toHaveCount(1);
  });

  /**
   * Applying a status filter while looking at one diver's orders used to
   * throw the staffer back to every diver's: the GET form carried no
   * `personId`, so submitting it dropped the very filter the page was
   * explaining in the line above the table.
   */
  test("a diver filter survives applying another filter, and says whose orders these are", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page.getByRole("link", { name: "Grace Halloran", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    const personId = new URL(page.url()).pathname.split("/").pop() ?? "";

    await page.goto(`/shop/blue-mantis/orders?personId=${personId}&range=all`);
    await expect(page.getByText("Showing orders for Grace Halloran.")).toBeVisible();

    await page.locator('#orders-search[data-hydrated="true"]').waitFor();
    await page.getByLabel("Status").selectOption("void");
    await expect(page).toHaveURL(new RegExp(`personId=${personId}`));

    // Grace has no voided orders, so this is also the empty-result case: the
    // sentence naming whose orders these are used to be read off the first row
    // and therefore vanished exactly here.
    await expect(page.getByText("Showing orders for Grace Halloran.")).toBeVisible();
    await expect(page.getByText("No DiveDay orders match these filters.")).toBeVisible();
  });

  /** A filter has to survive paging, or page 2 quietly shows the unfiltered set. */
  test("paging keeps the active filter", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=paid");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    const pager = page.getByRole("navigation", { name: "Pages" });
    // Not "skip if there's nothing to page": the seeded demo carries a
    // trailing quarter of invoices and the paid slice is far past one page
    // (src/db/seed-history.ts, src/db/seed-orders.ts), so a missing pager is
    // the regression, not a reason to pass. The early return this replaces
    // meant a filter that silently returned one page of results — exactly what
    // a dropped `status` on the count query looks like — ended the test green.
    await expect(pager.first()).toBeVisible();
    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/status=paid/);
    await expect(page).toHaveURL(/page=2/);
    // Every row on page 2, not "every row that happened to match" — iterating
    // the matched badges alone passes trivially when the match set is empty.
    // A settled order carries no pill at all (only exceptional states do), so
    // "every row is paid" reads as "no row wears one".
    const rows = ledgerRows(page);
    await expect(rows.first()).toBeVisible();
    await expect(rows.locator("span.rounded-full")).toHaveCount(0);
  });
});

/**
 * The demo never connects a Stripe account, which makes it the day-one shop:
 * `orders/new` refuses to open at all. It used to refuse by redirecting to a
 * notice code nothing rendered (with a diver in hand) or to `/divers` with no
 * message (without one) — so "New order" was a button that visibly did
 * nothing, on the very first shop anyone sees. The server-side gate is
 * unchanged; what these cover is that the refusal is now legible and that the
 * entry links stop leading into it.
 */
test.describe("no connected payment account", () => {
  signedInAsOwner();

  test("the orders index offers connecting payments instead of a dead New order", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();

    await expect(page.getByRole("link", { name: "New order" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Connect payments" }).first()).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings#money",
    );
  });

  test("reaching orders/new anyway lands back on Orders with a reason", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // Hiding the link is a courtesy; the page itself is the gate. A bookmark,
    // a deep link, or a shop that disconnected mid-session still gets here.
    await page.goto("/shop/blue-mantis/orders/new");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    // Not a URL assertion: FlashParams strips `?notice=payment-not-connected`
    // on mount, so the rendered banner is what proves the code was handled —
    // an unhandled code renders nothing and fails here.
    await expect(page.getByText(/Payments aren't connected yet/i).first()).toBeVisible();
  });

  test("reaching it with a diver in hand lands back on that diver with a reason", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page.getByRole("link", { name: "Grace Halloran", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    const personId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(personId).not.toBe("");

    // The record's invoice door is simply absent on a shop that cannot take
    // money — the Connect-payments CTA left the person page with the ADR.
    await expect(page.getByRole("link", { name: "+ New invoice" })).toHaveCount(0);

    await page.goto(`/shop/blue-mantis/orders/new?personId=${personId}`);
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    // This is the code that rendered *nothing* before — the whole bug.
    await expect(page.getByText(/Payments aren't connected yet/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect payments" }).first()).toBeVisible();
  });
});
