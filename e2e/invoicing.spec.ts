import type { Page, Request as PlaywrightRequest } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { counterPath, openRosterDetails, seededTripId } from "./helpers";

/**
 * Staff invoicing — `/shop/[shopSlug]/orders/new`, the front desk's "bill this
 * diver" form. It shipped with no e2e or visual coverage at all (the
 * 2026-08-03 test-system evaluation found it, hence the exemption
 * `scripts/route-coverage.json` carried for this route until this spec landed).
 *
 * ## The boundary this spec stops at
 *
 * A *successful* order cannot be produced in this fleet, and that is a property
 * of the environment rather than a gap in the test. `createOrder` (src/db/orders.ts)
 * writes its durable payment-intent row, then calls Stripe to create the real
 * invoice, and only inserts the local `orders` row once Stripe confirms. The
 * fleet sets no `STRIPE_SECRET_KEY`, so `invoicingProviderFromEnvironment()`
 * hands back `disabledInvoicingProvider` and every valid submission resolves as
 * `not_configured` → `stripe_failed`. `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` means
 * nothing would reach Stripe even if a key were present.
 *
 * So this spec pins everything reachable *without* a live charge — the same
 * framing e2e/refunds.spec.ts and e2e/promo-codes.spec.ts use:
 *
 * - the connect-first refusal (no order form at all until the shop can take money);
 * - the role refusal (raising an invoice is owner/manager work, H-14);
 * - the form rendering against real seeded customers;
 * - both pre-Stripe validation refusals, which never call Stripe;
 * - the Stripe-step failure, which is what a real submission actually reaches here.
 *
 * Orders that *exist* — the index, an order's detail, its money formatting — come
 * from the seed and are covered by e2e/orders-demo.spec.ts and the `orders` /
 * `order-detail` visual captures.
 */

const staffCopy = staffTranslator("en-US");
const NEW_ORDER = "/shop/blue-mantis/orders/new";
// `${fullName} — ${email}`, both deterministic in the seed (src/db/seed.ts).
const CUSTOMER = "Priya Sharma — priya.sharma@mail.example";
// A seeded departure with divers on it, so the roster has a seat to open.
const ROSTER_TRIP = "Two-Tank Reef — Molasses & French";

/** Compare only a boolean; request bodies and nonce values never enter test output. */
async function postedInvoiceFieldsMatch(
  request: PlaywrightRequest,
  expected: Partial<Record<"invoiceAttempt" | "bookingId" | "personId", string>>,
) {
  const bytes = request.postDataBuffer();
  if (!bytes) return false;
  const form = await new Response(new Uint8Array(bytes), {
    headers: { "content-type": request.headers()["content-type"] ?? "" },
  }).formData();
  return Object.entries(expected).every(([field, expectedValue]) => {
    const values = [...form.entries()].filter(
      ([name]) => name === field || name.endsWith(`_${field}`),
    );
    return values.length === 1 && values[0]?.[1] === expectedValue;
  });
}

/** The first seat on a seeded departure's roster, opened to its foot row. */
async function openFirstSeat(page: Page) {
  await page.goto(counterPath("blue-mantis", await seededTripId(page, "blue-mantis", ROSTER_TRIP)));
  const row = page.locator('#roster li[id^="booking-"]').first();
  await openRosterDetails(row);
  return row;
}

test("the order form is not reachable signed out", async ({ page }) => {
  await page.goto(NEW_ORDER);
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("a shop that can't take money lands on Orders with the reason, not a dead order form", async ({
    page,
  }) => {
    // No /api/test/seed-stripe-account here: the demo shop starts unconnected,
    // and `canAcceptPayments` is what the page checks before rendering a single
    // field. An invoice form for a shop with nowhere to send the money would be
    // a dead end, so the route lands back on Orders and says why — with the
    // connect path offered — instead of silently dumping on the divers list
    // (the explained-landing rule every payment gate now follows). FlashParams
    // strips the query, so assert the banner, not the URL param.
    await page.goto(NEW_ORDER);
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
    await expect(page.getByText(/Payments aren’t connected yet/).first()).toBeVisible();
  });

  test("an owner builds an invoice and it gets as far as Stripe, which this fleet can't reach", async ({
    page,
    request,
  }) => {
    // Marks the demo shop connected + charges-enabled in the database without
    // ever calling Stripe (the route's own doc comment) — it unlocks the
    // surface, never a real charge.
    await request.post("/api/test/seed-stripe-account");

    await page.goto(NEW_ORDER);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();

    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Order note").fill("Two-tank reef trip + rental set");
    // The initial line keeps stable posted names as more lines are added.
    const firstRow = page.locator('select[name="kind-0"]').filter({ visible: true });
    await firstRow.selectOption("trip_fee");
    await page
      .locator('input[name="description-0"]')
      .filter({ visible: true })
      .fill("Two-Tank Reef — Molasses & French");
    await page.locator('input[name="quantity-0"]').filter({ visible: true }).fill("2");
    await page.locator('input[name="unitAmount-0"]').filter({ visible: true }).fill("129.00");

    await page.getByRole("button", { name: "Create and send invoice" }).click();

    // The honest end of the road in this fleet: the form's own danger banner,
    // and staff are left on the page with the invoice still to send — not
    // dropped on an order that doesn't exist. Filtered by text because Next's
    // always-present `#__next-route-announcer__` also carries `role="alert"`,
    // so an unfiltered query is ambiguous the moment a navigation mounts it.
    await expect(page.getByRole("alert").filter({ hasText: "Stripe" })).toContainText(
      "Stripe couldn’t create that invoice. Try again in a moment.",
    );
    await expect(page).toHaveURL(/\/orders\/new/);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();
  });

  /**
   * **The positive half of the pair** (`.claude/rules/e2e.md`). Every other
   * assertion about this link in the suite is an absence, and an absence
   * naming a string nothing renders passes for the wrong reason — which is
   * precisely what happened: `e2e/orders-demo.spec.ts` spent this whole time
   * asserting no link named "+ New invoice", a label the app has never had
   * (#1920). One positive query of the same string is the only thing that
   * proves the name still matches anything.
   *
   * The href is asserted too, because the record's door is the one that
   * arrives with the diver already in hand.
   */
  test("an owner's diver record offers the invoice door, with that diver in hand", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page.getByRole("link", { name: "Grace Halloran", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();
    const personId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(personId).not.toBe("");

    await expect(page.getByRole("link", { name: "New invoice" })).toHaveAttribute(
      "href",
      `/shop/blue-mantis/orders/new?personId=${personId}`,
    );
  });

  /**
   * The positive half of the captain's absences below (issue #1925): an owner
   * at a shop that can take money is offered both doors, so the names the
   * captain's test looks for still match something.
   */
  test("an owner is offered New order on Orders and Create order on a seat", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await expect(page.getByRole("link", { name: "New order" }).first()).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders/new",
    );

    const seat = await openFirstSeat(page);
    await expect(seat.getByRole("link", { name: "Create order" })).toHaveAttribute(
      "href",
      /\/shop\/blue-mantis\/orders\/new\?personId=[0-9a-f-]+&bookingId=[0-9a-f-]+$/,
    );
  });

  test("an invoice with no priced line, or an out-of-bounds one, is refused before Stripe", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    // A customer but no line items at all: refused by the action itself, no
    // payment intent and no Stripe call.
    await page.goto(NEW_ORDER);
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByRole("button", { name: "Create and send invoice" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Pick a customer" })).toContainText(
      "Pick a customer and at least one line item with an amount.",
    );

    // A typed line whose amount is past the bound fails the *whole*
    // submission rather than silently dropping that row — a staff member who
    // typed four lines must never end up with a three-line invoice (CR-016).
    //
    // Re-navigating first, deliberately: this refusal renders the same words
    // as the one above, so asserting against a page that still carries the
    // previous banner would pass without the second submission ever happening.
    await page.goto(NEW_ORDER);
    await expect(page.getByRole("alert").filter({ hasText: "Pick a customer" })).toHaveCount(0);
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page
      .locator('input[name="description-0"]')
      .filter({ visible: true })
      .fill("Private charter");
    const amount = page.locator('input[name="unitAmount-0"]').filter({ visible: true });
    await amount.fill("250000");
    await page.getByRole("button", { name: "Create and send invoice" }).click();
    await expect(
      page.locator('input[name="unitAmount-0"]:invalid').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue("250000");
  });

  test("twenty complete invoice lines survive validation and repeated provider refusal", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto(NEW_ORDER);
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Order note").fill("Twenty-line test invoice");
    await page
      .getByLabel(staffCopy("orders.new.addressLine1"), { exact: true })
      .fill("12 Test Street");
    for (let index = 1; index < 20; index++)
      await page.getByRole("button", { name: staffCopy("orders.new.addItem") }).click();
    for (let index = 0; index < 20; index++) {
      await page
        .locator(`input[name="description-${index}"]`)
        .filter({ visible: true })
        .fill(`Test item ${index + 1}`);
      await page
        .locator(`input[name="unitAmount-${index}"]`)
        .filter({ visible: true })
        .fill(String(index + 1));
    }
    await page.locator('input[name="description-19"]').filter({ visible: true }).clear();
    const invalidLanding = page.waitForURL(/notice=invalid/);
    await page.getByRole("button", { name: staffCopy("orders.new.submit") }).click();
    await invalidLanding;
    await expect(page.locator('input[name="unitAmount-19"]').filter({ visible: true })).toHaveValue(
      "20",
    );
    await expect(page.getByLabel("Order note")).toHaveValue("Twenty-line test invoice");
    await page
      .locator('input[name="description-19"]')
      .filter({ visible: true })
      .fill("Corrected last item");
    const providerRefusal = async () => {
      const refusedLanding = page.waitForURL(/notice=stripe-failed/);
      await page.getByRole("button", { name: staffCopy("orders.new.submit") }).click();
      await refusedLanding;
      await expect(
        page.locator('input[name="description-19"]').filter({ visible: true }),
      ).toHaveValue("Corrected last item");
      await expect(
        page.locator('input[name="description-0"]').filter({ visible: true }),
      ).toHaveValue("Test item 1");
      await expect(page.getByLabel("Order note")).toHaveValue("Twenty-line test invoice");
      await expect(
        page.getByLabel(staffCopy("orders.new.addressLine1"), { exact: true }),
      ).toHaveValue("12 Test Street");
      await expect(
        page.getByRole("button", { name: staffCopy("orders.new.addItem") }),
      ).toBeDisabled();
    };
    await providerRefusal();
    await providerRefusal();
  });

  test("query-only client navigation changes the full invoice target and a same-target refusal retains it", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    await openFirstSeat(page);
    const seats = page.locator('#roster li[id^="booking-"]').filter({ visible: true });
    const urls: string[] = [];
    for (let index = 0; index < 2; index++) {
      const seat = seats.nth(index);
      await openRosterDetails(seat);
      const href = await seat
        .getByRole("link", { name: "Create order", exact: true })
        .getAttribute("href");
      if (!href) throw new Error("seeded seat has no invoice target");
      urls.push(href);
    }
    const targetA = new URL(urls[0], "https://example.test");
    const targetB = new URL(urls[1], "https://example.test");
    await page.goto(urls[0]);
    await page
      .locator('input[name="description-0"]')
      .filter({ visible: true })
      .fill("Target A edited fee");
    await page.getByLabel("Order note").fill("Target A note");
    const customerBName = (
      await page
        .getByLabel("Customer")
        .locator(`option[value="${targetB.searchParams.get("personId")}"]`)
        .textContent()
    )?.split(" — ")[0];
    if (!customerBName) throw new Error("target B customer missing from the shop selector");
    const formA = await page
      .locator('form:has([name="lineItemCount"])')
      .filter({ visible: true })
      .elementHandle();
    const navigated = page.waitForURL(
      (url) => url.searchParams.get("bookingId") === targetB.searchParams.get("bookingId"),
    );
    await page.evaluate((url) => {
      const router = (window as unknown as { next?: { router?: { push: (url: string) => void } } })
        .next?.router;
      if (!router) throw new Error("installed Next App Router debugger facade unavailable");
      router.push(url);
    }, urls[1]);
    await navigated;
    const formB = page.locator('form:has([name="lineItemCount"])').filter({ visible: true });
    await expect(formB.locator('input[name="bookingId"]')).toHaveValue(
      targetB.searchParams.get("bookingId") ?? "",
    );
    await expect(page.getByLabel("Customer")).toHaveValue(
      targetB.searchParams.get("personId") ?? "",
    );
    await expect(page.getByLabel("Order note")).toHaveValue("");
    await expect(
      page.locator("p").filter({ hasText: customerBName }).filter({ hasText: ROSTER_TRIP }),
    ).toBeVisible();
    expect(await formB.evaluate((node, previous) => node !== previous, formA)).toBe(true);
    expect(targetA.searchParams.get("bookingId") !== targetB.searchParams.get("bookingId")).toBe(
      true,
    );
    await page.getByLabel("Order note").fill("Target B retained note");
    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]),
    );
    const refused = page.waitForURL(/notice=stripe-failed/);
    await page.getByRole("button", { name: staffCopy("orders.new.submit") }).click();
    expect(
      await postedInvoiceFieldsMatch(await posted, {
        bookingId: targetB.searchParams.get("bookingId") ?? "",
        personId: targetB.searchParams.get("personId") ?? "",
      }),
    ).toBe(true);
    await refused;
    await expect(formB.locator('input[name="bookingId"]')).toHaveValue(
      targetB.searchParams.get("bookingId") ?? "",
    );
    await expect(page.getByLabel("Customer")).toHaveValue(
      targetB.searchParams.get("personId") ?? "",
    );
    await expect(page.getByLabel("Order note")).toHaveValue("Target B retained note");
  });

  test("completion cleanup preserves unrelated attempts and consumes only the matching current draft", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    const submitDraft = async (description: string) => {
      await page.goto(NEW_ORDER);
      await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
      await page.locator('input[name="description-0"]').filter({ visible: true }).fill(description);
      await page.locator('input[name="unitAmount-0"]').filter({ visible: true }).fill("12");
      const submittedRequest = page.waitForRequest(
        (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]),
      );
      const refusedLanding = page.waitForURL(/notice=stripe-failed/);
      await page.getByRole("button", { name: staffCopy("orders.new.submit") }).click();
      await refusedLanding;
      await expect(
        page.locator('input[name="description-0"]').filter({ visible: true }),
      ).toHaveValue(description);
      const draft = await page.evaluate(() => {
        const key = Object.keys(sessionStorage).find(
          (candidate) =>
            candidate.startsWith("diveday.refused-form.blue-mantis.") &&
            candidate.endsWith(".new-order"),
        );
        if (!key) throw new Error("submitted draft was not retained");
        const raw = sessionStorage.getItem(key);
        if (!raw) throw new Error("submitted draft is empty");
        return { key, raw, attempt: String(JSON.parse(raw).attempt) };
      });
      expect(
        await postedInvoiceFieldsMatch(await submittedRequest, { invoiceAttempt: draft.attempt }),
      ).toBe(true);
      return draft;
    };
    const current = await submitDraft("Pending first invoice");
    await page.evaluate(() =>
      sessionStorage.setItem("diveday.refused-form.other-shop.other-staffer.new-order", "keep"),
    );
    // An existing synthetic order isolates landing cleanup. The disabled fleet provider cannot complete a real create.
    await page.goto("/shop/blue-mantis/orders");
    await page
      .locator('ul[aria-labelledby^="orders-day-"] > li')
      .filter({ visible: true })
      .first()
      .getByRole("link")
      .first()
      .click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
    const orderUrl = page.url().split("?")[0];
    await page.goto(`${orderUrl}?invoiceCreated=1`);
    await expect(page).not.toHaveURL(/invoiceCreated=/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), current.key)).toBe(
      current.raw,
    );
    await page.goto(`${orderUrl}?invoiceCreated=ffffffff-ffff-4fff-8fff-ffffffffffff`);
    await expect(page).not.toHaveURL(/invoiceCreated=/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), current.key)).toBe(
      current.raw,
    );
    await page.goto(`${orderUrl}?invoiceCreated=${current.attempt}`);
    await expect
      .poll(() => page.evaluate((key) => sessionStorage.getItem(key), current.key))
      .toBeNull();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("diveday.refused-form.other-shop.other-staffer.new-order"),
      ),
    ).toBe("keep");
    const newer = await submitDraft("Pending newer invoice");
    expect(newer.attempt !== current.attempt).toBe(true);
    await page.goto(`${orderUrl}?invoiceCreated=${current.attempt}`);
    await expect(page).not.toHaveURL(/invoiceCreated=/);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), newer.key)).toBe(newer.raw);
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  /**
   * Billing a diver is owner/manager work, same as the refund on the order it
   * becomes and the discount codes that set what a trip costs (H-14, ADR
   * 20260724-role-authorization, extended by 20260803-invoicing-role-gate).
   * This spec used to pin the opposite — any staff role could raise an invoice —
   * as the place that decision would become visible; it was made, and this is
   * now the refusal.
   *
   * A captain keeps *reading* orders, which is why the landing is the Orders
   * index with the reason rather than Today: the door is closed, not the room.
   */
  test("a captain is turned away from the order form and told why", async ({ page, request }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto(NEW_ORDER);

    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
    // FlashParams strips the query, so assert the banner, not the URL param.
    await expect(page.getByText(/limited to owners and managers/).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toHaveCount(0);
  });

  /**
   * **And the record does not offer the door it knows is closed** (issue #1920).
   *
   * The refusal above is the boundary and it stays. This is the other half of
   * ADR 20260724-role-authorization: the UI hides a control the permission
   * denies, so nobody is shown a button they will be bounced from. Before this,
   * a captain reading a diver saw "New invoice" at the foot of their story and
   * paid for the click with the person they were reading.
   *
   * `seed-stripe-account` first, deliberately. With payments unconnected the
   * link is absent for *everyone*, and the assertion would pass for a reason
   * that has nothing to do with the role — which is exactly how the same
   * assertion in e2e/orders-demo.spec.ts sat green while naming a label that
   * does not exist.
   */
  test("a captain's diver record offers no invoice door, at a shop that can take money", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Grace Halloran");
    await page.getByRole("link", { name: "Grace Halloran", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Grace Halloran" }).waitFor();

    // The story itself is there — a captain reads the whole record and is
    // refused the one act, so an empty page would prove nothing.
    await expect(page.getByRole("heading", { name: "The story" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New invoice" })).toHaveCount(0);
  });

  /**
   * **The other three doors** (issue #1925): the Orders index's "New order"
   * (header and empty state share one gate) and the per-seat "Create order"
   * on a roster. Each would land a captain back on the Orders index with the
   * refusal above, which then offered "New order" again — a loop between a
   * button and its own refusal. Stripe seeded first for the reason the test
   * above gives; the owner's test pins both names positively.
   */
  test("a captain is offered no New order or Create order, at a shop that can take money", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    await page.goto("/shop/blue-mantis/orders");
    await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
    await expect(page.getByRole("link", { name: "New order" })).toHaveCount(0);

    const seat = await openFirstSeat(page);
    // The seat's foot row is open — its other control is there — so the
    // missing link is the permission, not a closed disclosure.
    await expect(seat.getByRole("button", { name: "Remove booking" })).toBeVisible();
    await expect(seat.getByRole("link", { name: "Create order" })).toHaveCount(0);
  });
});
