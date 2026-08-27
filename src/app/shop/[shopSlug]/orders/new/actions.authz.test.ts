import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { orders, shops } from "@/db/schema";
import { setShopTaxEnabled } from "@/db/shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * Raising an invoice bills a real person on the shop's own connected Stripe
 * account, with the shop's name on it — money work, like the refund on the
 * order it becomes and the discount codes that set what a trip costs (H-14,
 * ADR 20260724-role-authorization). `orders/new/page.tsx` bounces anyone else
 * before it renders a field, but a page that refuses is not a gate: a form post
 * from a captain's browser reaches `createOrderAction` all the same (ADR-0006).
 *
 * These run the real action against a real seeded shop and pin both halves: the
 * refusal notice, *and* that no order row appeared. There is a second gate
 * underneath — `createOrder` re-runs the same live-role check inside
 * `src/db/orders.ts`, so deleting the action's gate line turns the notice
 * assertions below red while the database still refuses, which is what defense
 * in depth is supposed to look like.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { createOrderAction } = await import("./actions");

async function orderCount(db: AppDb, shopId: string) {
  return (await db.select({ id: orders.id }).from(orders).where(eq(orders.shopId, shopId))).length;
}

/** Seeded shop with a payable Stripe account, plus both actors. */
async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  // Marks the shop connected in the database only — no Stripe call. Without it
  // every submission would stop at `not_connected` and the role gate would
  // never be the thing under test.
  await upsertShopStripeAccount(db, shop.id, "acct_authz");
  await setShopStripeAccountStatus(db, "acct_authz", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

/** A complete, valid one-line invoice for a seeded diver. */
function invoiceFor(personId: string) {
  const formData = new FormData();
  formData.set("personId", personId);
  formData.set("description", "Two-tank reef trip");
  formData.set("kind-0", "trip_fee");
  formData.set("description-0", "Two-Tank Reef — Molasses & French");
  formData.set("quantity-0", "1");
  formData.set("unitAmount-0", "129.00");
  return formData;
}

/** Any seeded diver at the shop — who is billed doesn't matter here. */
async function seededCustomer(db: AppDb, shopId: string) {
  const { listOrderableCustomers } = await import("@/db/orders");
  const [customer] = await listOrderableCustomers(db, shopId);
  if (!customer) throw new Error("seeded shop has no people to invoice");
  return customer.id;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("raising an invoice", () => {
  it("refuses a captain — billing a diver is owner/manager work, not deck work", async () => {
    const { db, shop, captain } = await context();
    const customer = await seededCustomer(db, shop.id);
    signIn(shop, captain);
    const before = await orderCount(db, shop.id);

    const to = await redirectedTo(() => createOrderAction(invoiceFor(customer)));

    expect(to).toBe(`/shop/${shop.slug}/orders?notice=not-authorized`);
    // The refusal is only worth anything if no invoice went out behind it.
    expect(await orderCount(db, shop.id)).toBe(before);
  });

  it("refuses a captain whose session claims otherwise", async () => {
    // The session is a JWT minted at sign-in, so its roles can be stale — a
    // demoted staff member keeps an owner claim until they sign in again — and a
    // forged one is not a wild scenario for a token the client holds. Sal is a
    // captain in `person_roles` whatever the token says, and the gate reads
    // `person_roles`.
    const { db, shop, captain } = await context();
    const customer = await seededCustomer(db, shop.id);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: shop.id,
        shopSlug: shop.slug,
        personId: captain,
        roles: ["owner", "manager"],
      }),
    );
    const before = await orderCount(db, shop.id);

    const to = await redirectedTo(() => createOrderAction(invoiceFor(customer)));

    expect(to).toBe(`/shop/${shop.slug}/orders?notice=not-authorized`);
    expect(await orderCount(db, shop.id)).toBe(before);
  });

  it("lets an owner through the gate to the invoice itself", async () => {
    const { db, shop, owner } = await context();
    const customer = await seededCustomer(db, shop.id);
    signIn(shop, owner);

    const to = await redirectedTo(() => createOrderAction(invoiceFor(customer)));

    // The far end of the road without a live Stripe key: no invoicing provider
    // is configured in a unit run, so the submission reaches Stripe's step and
    // fails there — on `orders/new` itself, with the invoice still to send. A
    // captain never sees this notice, which is the point: the two refusals are
    // distinguishable, and only one of them is about authorization.
    expect(to).toBe(`/shop/${shop.slug}/orders/new?notice=stripe-failed`);
  });

  it("requires a billing location before a tax-enabled invoice can be sent", async () => {
    const { db, shop, owner } = await context();
    const customer = await seededCustomer(db, shop.id);
    await setShopTaxEnabled(db, shop.id, true);
    // **A real shop.** The fixture is the canonical demo, and a demo with tax
    // on and no address supplied bills itself rather than refusing
    // (`demoShopBillingAddress`) — deliberate, for the one shop with nobody to
    // ask, and the opposite of the rule under test here.
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    signIn(shop, owner);
    const before = await orderCount(db, shop.id);

    const to = await redirectedTo(() => createOrderAction(invoiceFor(customer)));

    expect(to).toBe(`/shop/${shop.slug}/orders/new?notice=tax-location-required`);
    expect(await orderCount(db, shop.id)).toBe(before);
  });
});
