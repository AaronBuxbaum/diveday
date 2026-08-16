import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * READ_ONLY holds here: every one of these reads the orders index, its filters and its
 * pager, or a refusal page. The Stripe-calling controls are asserted *disabled*, and
 * "Apply filters" is a GET form — a navigation, not a write.
 */

// The seeded demo carries a billing history whose orders have fabricated Stripe
// ids (the demo never connects an account). The Stripe-calling controls —
// Refund on the diver profile, Refresh/Void/Refund on the order page — are
// disabled on a demo shop with a hover reason, and the actions refuse before any
// Stripe call (ADR 20260723-owner-reporting; src/db/seed.ts).

test.describe("demo billing history", () => {
  signedInAsOwner();

  test("a paid demo order's refund control is disabled with a reason", { tag: READ_ONLY }, async ({
    page,
  }) => {
    // A seeded historical diver with a paid order on file. The extended
    // roster is well past one default page, sorted alphabetically — search
    // for her rather than assume she's on the unfiltered first page.
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page
      .getByRole("row")
      .filter({ hasText: "Grace Halloran" })
      .getByRole("link")
      .first()
      .click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();

    const refund = page.getByRole("button", { name: "Refund" }).first();
    await expect(refund).toBeVisible();
    await expect(refund).toBeDisabled();
    await expect(refund).toHaveAttribute("title", /demo order/i);

    // The order page reached from the same row disables its Stripe actions too.
    await page.getByRole("link", { name: "Open payment" }).first().click();
    await page.waitForURL(/\/orders\//);
    const orderRefund = page.getByRole("button", { name: /Refund|Void|Refresh/ }).first();
    await expect(orderRefund).toBeDisabled();
    await expect(page.getByText(/backed by a live Stripe invoice/i)).toBeVisible();
  });

  test("an order opened from the index says when it was raised and offers both ways back", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // Arriving from the index (not from a diver) used to leave browser-back as
    // the only exit, and the date the index column showed disappeared on the
    // way in — on the one screen a refund argument turns on.
    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();
    const firstRow = page.locator("tbody tr").filter({ visible: true }).first();
    const rowDate = ((await firstRow.locator("td").nth(3).textContent()) ?? "").trim();
    await firstRow.getByRole("link").first().click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);

    // The same day the row showed, plus who raised it.
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

    const rows = page.locator("tbody tr").filter({ visible: true });
    await expect(rows.first()).toBeVisible();
    const firstPageCount = await rows.count();
    expect(firstPageCount).toBeLessThanOrEqual(50);
    // The diver link specifically. The whole row — and even its first cell —
    // carries a mobile-only trip line whose newlines `toHaveText` normalizes
    // away, so comparing either fails on formatting rather than on content.
    const firstDiver = (await rows.first().getByRole("link").first().textContent()) ?? "";

    // The pager states the whole set, not just what is on screen.
    const pager = page.getByRole("navigation", { name: "Pages" });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText(/Page 1 of \d+/);

    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/[?&]page=2/);
    await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
    // Different orders, not the same screen re-rendered.
    await expect(page.locator("tbody tr").first().getByRole("link").first()).not.toHaveText(
      firstDiver,
    );

    // And back, without losing the pager.
    await page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("link", { name: "Previous" })
      .click();
    await expect(page.locator("tbody tr").first().getByRole("link").first()).toHaveText(firstDiver);
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
    const range = page.getByLabel("Date range");
    await expect(range).toHaveValue("recent");

    const windowed = await page.locator("tbody tr").filter({ visible: true }).count();
    const windowedTotal = await page.getByRole("navigation", { name: "Pages" }).textContent();

    await range.selectOption("all");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByLabel("Date range")).toHaveValue("all");
    // A strictly larger set — otherwise the window was never doing anything,
    // and this test would pass on a page that silently ignores `?range=`.
    const allTotal = await page.getByRole("navigation", { name: "Pages" }).textContent();
    expect(allTotal).not.toBe(windowedTotal);
    expect(await page.locator("tbody tr").filter({ visible: true }).count()).toBeGreaterThanOrEqual(
      windowed,
    );

    // And back to the safe default, so the range control is not one-way.
    await page.getByLabel("Date range").selectOption("recent");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/range=recent/);
    await expect(page.getByLabel("Date range")).toHaveValue("recent");
  });

  test("status badges align with the order row", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto("/shop/blue-mantis/orders?status=open&range=all");
    await page.getByRole("heading", { level: 1, name: "Orders" }).waitFor();

    const row = page.locator("tbody tr").filter({ hasText: "Open — awaiting payment" }).first();
    await expect(row).toBeVisible();
    await expect(row.locator("td").nth(2)).toHaveClass(/align-middle/);
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
    await page
      .getByRole("row")
      .filter({ hasText: "Grace Halloran" })
      .getByRole("link")
      .first()
      .click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    const personId = new URL(page.url()).pathname.split("/").pop() ?? "";

    await page.goto(`/shop/blue-mantis/orders?personId=${personId}&range=all`);
    await expect(page.getByText("Showing orders for Grace Halloran.")).toBeVisible();

    await page.getByLabel("Status").selectOption("void");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`personId=${personId}`));

    // Grace has no voided orders, so this is also the empty-result case: the
    // sentence naming whose orders these are used to be read off the first row
    // and therefore vanished exactly here.
    await expect(page.getByText("Showing orders for Grace Halloran.")).toBeVisible();
    await expect(page.getByText("No orders match these filters.")).toBeVisible();
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
    // A settled order renders an empty status cell (only exceptional states
    // carry a badge), so "every row is paid" reads as "no row carries one".
    const rows = page.locator("tbody tr").filter({ visible: true });
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      await expect(row.locator("td").nth(2)).toHaveText("");
    }
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
    await page
      .getByRole("row")
      .filter({ hasText: "Grace Halloran" })
      .getByRole("link")
      .first()
      .click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    const personId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(personId).not.toBe("");

    // The diver record's own order buttons are replaced, not dead.
    await expect(page.getByRole("link", { name: "New payment" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Connect payments" }).first()).toHaveAttribute(
      "href",
      "/shop/blue-mantis/settings#money",
    );

    await page.goto(`/shop/blue-mantis/orders/new?personId=${personId}`);
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    // This is the code that rendered *nothing* before — the whole bug.
    await expect(page.getByText(/Payments aren't connected yet/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect payments" }).first()).toBeVisible();
  });
});
