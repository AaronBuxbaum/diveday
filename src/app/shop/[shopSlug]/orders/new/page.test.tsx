import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, trips } from "@/db/schema";
import { getShopBySlug, setShopCurrency, setShopTaxEnabled } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { findElements, inputNamesIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";

const ctx = fileScopedShopContext();

// Same mocking shape as ../page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, better-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const { OrderEditor } = await import("./OrderEditor");
const { InvoiceForm } = await import("./InvoiceForm");
const { invoiceTargetKey } = await import("./order-form");
const NewOrderPage = (await import("./page")).default;
const { InvoiceAddressFields } = await import("../_components/InvoiceAddressFields");

const SHOP_SLUG = "blue-mantis";

/**
 * The seeded shop with a charges-enabled Connect account, mocked in, plus one
 * real booking id. Without the account the page redirects before it reads
 * anything, which would make every assertion below vacuous.
 */
async function shopThatCanBill() {
  const db: AppDb = ctx.db;
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  const account = await upsertShopStripeAccount(db, shop.id, "acct_unit_test");
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!booking) throw new Error("the seed has no bookings");
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: SHOP_SLUG,
      name: owner.fullName,
      email: "staff@demo.invalid",
      roles: owner.roles,
    },
  });
  return { bookingId: booking.id, db, shop };
}

function renderWith(searchParams: Record<string, string> = {}) {
  return NewOrderPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
  });
}

/**
 * The page with its billing-location fieldset drawn. That fieldset is its own
 * component (`InvoiceAddressFields`, shared with the counter-rental form), and
 * the element walk does not call components, so the test calls it.
 */
async function renderWithAddress(searchParams: Record<string, string> = {}) {
  const tree = await renderWith(searchParams);
  return [
    tree,
    findElements<Parameters<typeof InvoiceAddressFields>[0]>(tree, InvoiceAddressFields).map(
      (element) => InvoiceAddressFields(element.props),
    ),
  ];
}

/*
 * `?bookingId=` and `?personId=` arrive from links other pages build — a diver
 * record, a roster row — and a link is exactly the thing that gets truncated in
 * a chat message. `bookings.id` is a `uuid` column, so an unguarded stray value
 * is not an empty prefill but `invalid input syntax for type uuid`, a 500 on
 * the page a staffer only mistyped their way onto
 * (FU-20260814-orders-stray-person-id-500's sweep).
 */
describe("the prefill ids", () => {
  it("fills the form from a real booking", async () => {
    const { bookingId } = await shopThatCanBill();
    // The booking rides the form as a hidden field, which is the visible proof
    // the lookup ran — so the malformed case below is an observable difference
    // rather than "nothing happened either way".
    const tree = await renderWith({ bookingId });
    const editor = findElements<Parameters<typeof OrderEditor>[0]>(tree, OrderEditor)[0];
    const targetForm = findElements<Parameters<typeof InvoiceForm>[0]>(tree, InvoiceForm)[0];
    expect(targetForm?.props.identity.endsWith(invoiceTargetKey(bookingId, null))).toBe(true);
    expect(editor?.props.target).toBe(invoiceTargetKey(bookingId, null));
    expect(editor?.props.bookingId).toBe(bookingId);
    expect(editor?.props.defaults.length).toBeGreaterThan(0);
  });

  it("treats a malformed booking id as no prefill at all", async () => {
    await shopThatCanBill();
    // The blank order form a staffer can still use — never a thrown query.
    const editor = findElements<Parameters<typeof OrderEditor>[0]>(
      await renderWith({ bookingId: "nope" }),
      OrderEditor,
    )[0];
    expect(editor?.props.bookingId).toBeNull();
    expect(editor?.props.defaults).toEqual([]);
  });
});

describe("the tax location form", () => {
  it("keeps billing location fields off when tax is disabled", async () => {
    // Turned off explicitly. The seeded demo now ships with Stripe Tax **on**
    // (src/db/seed.ts), so leaning on the fixture's default made this test
    // assert the opposite of its own name.
    const { db, shop } = await shopThatCanBill();
    await setShopTaxEnabled(db, shop.id, false);
    expect(inputNamesIn(await renderWithAddress())).not.toContain("customerAddressLine1");
  });

  it("shows billing location fields when tax is enabled", async () => {
    const { db, shop } = await shopThatCanBill();
    await setShopTaxEnabled(db, shop.id, true);

    const names = inputNamesIn(await renderWithAddress());
    expect(names).toEqual(
      expect.arrayContaining([
        "customerAddressLine1",
        "customerAddressCity",
        "customerAddressPostalCode",
        "customerAddressCountry",
      ]),
    );
  });

  /**
   * The legend's `px-1` pads the notch it cuts in the fieldset's border, and
   * also moved its words 4px right of every field under it (x 326 against 322
   * at 1280, 58 against 54 at 390; K-289). `legendClass` keeps the notch and
   * pulls the words back onto the content edge.
   */
  it("starts the tax-location legend's words on its fields' edge", async () => {
    const { db, shop } = await shopThatCanBill();
    await setShopTaxEnabled(db, shop.id, true);

    // The bordered fieldset's legend: the one that cuts a notch.
    const bordered = findElements<{ className?: string; children?: unknown }>(
      await renderWithAddress(),
      "fieldset",
    ).filter((fieldset) => /\bborder\b/.test(fieldset.props.className ?? ""));
    const legends = bordered.flatMap((fieldset) =>
      findElements<{ className?: string }>(fieldset.props.children, "legend"),
    );
    expect(legends).toHaveLength(1);
    expect(legends[0]?.props.className).toContain("-ms-1 px-1");
  });
});

describe("the invoice editor", () => {
  it("receives the shop currency, scoped refusal context and no empty extra defaults", async () => {
    await shopThatCanBill();
    const editor = findElements<Parameters<typeof OrderEditor>[0]>(
      await renderWith(),
      OrderEditor,
    )[0];
    expect(editor?.props.defaults).toEqual([]);
    expect(editor?.props.currency).toBe("usd");
    expect(editor?.props.scope).toMatch(/^blue-mantis\./);
    expect(editor?.props.restore).toBe(false);
  });

  it("names the shop currency in the unit-price field for a JPY invoice", async () => {
    const { db, shop } = await shopThatCanBill();
    await setShopCurrency(db, shop.id, "jpy");
    const editor = findElements<Parameters<typeof OrderEditor>[0]>(
      await renderWith(),
      OrderEditor,
    )[0];
    expect(editor?.props.words.unitPrice).toContain("JPY");
    expect(editor?.props.words.unitPrice).not.toContain("USD");
    expect(editor?.props.words).not.toHaveProperty("unitPricePlaceholder");
  });

  it("restores a refused invoice while retaining the billing-location controls", async () => {
    const { db, shop } = await shopThatCanBill();
    await setShopTaxEnabled(db, shop.id, true);
    const tree = await renderWithAddress({ notice: "stripe-failed" });
    const editor = findElements<Parameters<typeof OrderEditor>[0]>(tree, OrderEditor)[0];
    expect(editor?.props.restore).toBe(true);
    expect(inputNamesIn(tree)).toContain("customerAddressLine1");
  });
});
