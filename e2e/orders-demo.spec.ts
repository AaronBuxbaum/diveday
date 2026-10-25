import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";

const staffCopy = staffTranslator("en-US");

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
// "entries", not "orders": the ledger lists online seat payments beside orders.
const orderCount = (page: Page) => page.getByText(/^\d+ entr(?:y|ies)$/);

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
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await ledgerRows(page).first().getByRole("link").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
    const orderRefund = page.getByRole("button", { name: /Refund|Void|Refresh/ }).first();
    await expect(orderRefund).toBeDisabled();
    await expect(page.getByText(staffCopy("orders.detail.demoRefundHint")).first()).toBeVisible();
  });

  test("an order opened from the index says when it was raised and offers both ways back", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // Arriving from the index (not from a diver) used to leave browser-back as
    // the only exit, and the date the index showed disappeared on the way in —
    // on the one screen a refund argument turns on.
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
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

    // Both journeys home, neither of them the browser's back button: the
    // diver's record rides in the header's meta line as a quiet link, and the
    // eyebrow is the way back to the index (principle 10).
    await expect(page.getByRole("link", { name: "Diver record" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
  });

  /**
   * **A deposit names the departure it was for** (third UX review, item 32).
   * "Trip deposit (Deposit) $54.00" was the whole page: which boat, on what
   * day, was on the new-order form and lost once the order was sent.
   */
  test("a deposit order names its departure and links to it", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/orders?q=Trip+deposit");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await ledgerRows(page).first().getByRole("link").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
    await expect(page.getByText(/^Linked to .+’s booking on .+ \(.+\)\./)).toBeVisible();
    await page.getByRole("link", { name: "Open the departure" }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}/);
  });

  /**
   * **The ledger as a bookkeeper's file** (third UX review, item 34): the
   * filtered orders, one row per line, across every page.
   */
  test("downloads the filtered orders as one CSV", { tag: READ_ONLY }, async ({
    page,
    request,
  }) => {
    await page.goto("/shop/blue-mantis/orders?range=all&status=paid");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    const link = page.getByRole("link", { name: "Download orders (CSV)" });
    await expect(link).toHaveAttribute("href", /\/orders\/download\?.*status=paid/);
    const downloadPromise = page.waitForEvent("download");
    await link.click();
    expect((await downloadPromise).suggestedFilename()).toMatch(
      /^diveday-orders-blue-mantis-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const response = await request.get("/shop/blue-mantis/orders/download?range=all&status=paid");
    expect(response.status()).toBe(200);
    const [header, ...rows] = (await response.text()).trimEnd().split("\r\n");
    expect(header).toBe(
      "Order,Raised,Diver,Departure,Departure date,Status,Paid on,Method,Line kind,Line,Quantity,Line amount,Order total,Tax,Paid,Refunded,Currency",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.includes(",paid,"))).toBe(true);
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
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();

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
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
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
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
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

  /**
   * **Record payment works on a demo order** (market sheet 2026-10-22, item
   * 6): cash and the card machine never touch Stripe, so they are live
   * buttons; Refresh and Void stay disabled with the demo note. Asserted, not
   * pressed: the seeded open invoice is the one other specs read.
   */
  test("an open demo order records cash and the card machine; only Stripe actions are disabled", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=open&range=all");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await ledgerRows(page)
      .filter({ has: page.getByText("Open", { exact: true }) })
      .first()
      .getByRole("link")
      .first()
      .click();
    await page.getByRole("link", { name: "Diver record" }).waitFor();
    await expect(page.getByRole("button", { name: "Cash", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Card machine", exact: true })).toBeEnabled();
    await expect(page.getByText("Charge to room", { exact: true })).toHaveCount(0);
    // Refresh and Void sit in the header's More menu (visual review A16).
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh status" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Void order" })).toBeDisabled();
    await expect(page.getByText(staffCopy("orders.detail.demoActionHint"))).toBeVisible();
  });

  test("an exceptional status wears the row's one pill", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=open&range=all");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();

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
    await expect(
      page.getByText(staffCopy("orders.index.filteredByDiver", { name: "Grace Halloran" }), {
        exact: true,
      }),
    ).toBeVisible();

    await page.locator('#orders-search[data-hydrated="true"]').waitFor();
    await page.getByLabel("Status").selectOption("void");
    await expect(page).toHaveURL(new RegExp(`personId=${personId}`));

    // Grace has no voided orders, so this is also the empty-result case: the
    // sentence naming whose orders these are used to be read off the first row
    // and therefore vanished exactly here.
    await expect(
      page.getByText(staffCopy("orders.index.filteredByDiver", { name: "Grace Halloran" }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("No orders match these filters")).toBeVisible();
  });

  /** A filter has to survive paging, or page 2 quietly shows the unfiltered set. */
  test("paging keeps the active filter", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=paid");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
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

  test("the orders index offers neither a dead New order nor a setup ask on the demo", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();

    await expect(page.getByRole("link", { name: "New order" })).toHaveCount(0);
    // A shop shown running with paid orders does not open on "Take payments
    // with DiveDay" (fourth review, item 53); a real shop with no account
    // still gets the card (orders/page.test.tsx).
    await expect(page.getByText("Take payments with DiveDay")).toHaveCount(0);
  });

  test("reaching orders/new anyway lands back on Orders with a reason", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // Hiding the link is a courtesy; the page itself is the gate. A bookmark,
    // a deep link, or a shop that disconnected mid-session still gets here.
    await page.goto("/shop/blue-mantis/orders/new");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    // Not a URL assertion: FlashParams strips `?notice=payment-not-connected`
    // on mount, so the rendered banner is what proves the code was handled —
    // an unhandled code renders nothing and fails here.
    await expect(page.getByText(/Payments aren’t connected yet/i).first()).toBeVisible();
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
    // The name is "New invoice", with no plus: written "+ New invoice" this
    // matched nothing whatever the page showed, so it could not fail (#1920).
    await expect(page.getByRole("link", { name: "New invoice" })).toHaveCount(0);

    await page.goto(`/shop/blue-mantis/orders/new?personId=${personId}`);
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    // This is the code that rendered *nothing* before — the whole bug.
    await expect(page.getByText(/Payments aren’t connected yet/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect payments" }).first()).toBeVisible();
  });
});

// A bulk file of diver names and money is the owner's or manager's to take
// away, as Reports' CSV is; the daily crew reads the ledger but gets no file.
test.describe("the orders download, for the daily crew", () => {
  signedInAs("captain");

  test("is refused, and not offered", { tag: READ_ONLY }, async ({ page, request }) => {
    const response = await request.get("/shop/blue-mantis/orders/download?range=all");
    expect(response.status()).toBe(403);
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await expect(page.getByRole("link", { name: "Download orders (CSV)" })).toHaveCount(0);
  });
});
