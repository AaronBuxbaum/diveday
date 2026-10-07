import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shopSubscriptions, shops } from "@/db/schema";
import {
  applyBillingEffect,
  getShopSubscription,
  recordShopCheckoutSession,
} from "@/db/shop-subscriptions";
import { seededShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The two doors out to Stripe, run for real against a seeded database with the
 * session, Next's `redirect`, and Stripe's HTTP faked. What matters is what
 * happens *before* Stripe is asked anything: the owner gate re-read from live
 * roles, the demo shop refused, and an unconfigured deployment refused — and,
 * once asked, that the subscription the Portal cancels is the shop's own.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { startBillingCheckoutAction, openBillingPortalAction } = await import("./actions");

const fetchMock = vi.fn<typeof fetch>();

function stripeAnswers(body: unknown) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }));
}

async function context({ demo = false } = {}) {
  const { db, shop } = await seededShopContext();
  if (!demo) await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const signIn = (personId: string) =>
    vi.mocked(requireStaffSession).mockResolvedValue(
      // The JWT claims owner every time: the gate must read the database instead.
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId, roles: ["owner"] }) as never,
    );
  return { db, shop, owner, captain, signIn };
}

function configure() {
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_billing");
  vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "whsec_billing");
  vi.stubEnv("BILLING_STRIPE_PRICE_ID", "price_monthly");
  vi.stubEnv("APP_HOST", "https://dive.day");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the owner gate", () => {
  it("refuses a captain whose session claims owner, before Stripe hears anything", async () => {
    const { captain, signIn } = await context();
    configure();
    signIn(captain);
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis?notice=billing-not-authorized",
    );
    expect(await redirectedTo(() => openBillingPortalAction(new FormData()))).toBe(
      "/shop/blue-mantis?notice=billing-not-authorized",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a manager: billing is the owner's alone", async () => {
    const { db, owner, signIn } = await context();
    configure();
    await demoteOwnerToManager(db, owner);
    signIn(owner);
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis?notice=billing-not-authorized",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("before Stripe is asked", () => {
  it("says billing is not turned on when the three values are absent", async () => {
    const { owner, signIn } = await context();
    signIn(owner);
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis/settings/billing?notice=not-configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never bills a demo shop", async () => {
    const { owner, signIn } = await context({ demo: true });
    configure();
    signIn(owner);
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis/settings/billing?notice=demo",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Add a card", () => {
  it("mints the shop's customer, records it, and opens Checkout deferred to the end of the trial", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cus_new" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/1" }), {
          status: 200,
        }),
      );
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "https://checkout.stripe.com/c/1",
    );
    expect(await getShopSubscription(db, shop.id)).toMatchObject({
      stripeCustomerId: "cus_new",
      stripeCheckoutSessionId: "cs_1",
    });
    const checkoutBody = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(checkoutBody.get("client_reference_id")).toBe(shop.id);
    expect(checkoutBody.get("customer")).toBe("cus_new");
    expect(checkoutBody.get("success_url")).toBe(
      "https://dive.day/shop/blue-mantis/settings/billing?notice=card-added",
    );
  });

  it("says Stripe did not answer, rather than throwing, when the customer call fails", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis/settings/billing?notice=unavailable",
    );
    expect(await getShopSubscription(db, shop.id)).toBeNull();
  });

  it("sends a shop that already pays to the Portal instead of a second subscription", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    stripeAnswers({ id: "cus_new", url: "https://billing.stripe.com/p/1" });
    await db.insert(shopSubscriptions).values({
      shopId: shop.id,
      stripeCustomerId: "cus_paid",
    });
    await applyBillingEffect(db, {
      kind: "subscription_changed",
      customerId: "cus_paid",
      subscriptionId: "sub_paid",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      shopIdClaim: shop.id,
      occurredAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "https://billing.stripe.com/p/1",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stripe.com/v1/billing_portal/sessions",
    );
  });
});

describe("one subscription per shop", () => {
  async function linkedWithoutStatus() {
    const ctx = await context();
    configure();
    ctx.signIn(ctx.owner);
    await ctx.db.insert(shopSubscriptions).values({
      shopId: ctx.shop.id,
      stripeCustomerId: "cus_paid",
      stripeSubscriptionId: "sub_linked",
    });
    return ctx;
  }

  it("sends a shop whose subscription is linked but not yet described to the Portal", async () => {
    await linkedWithoutStatus();
    stripeAnswers({ url: "https://billing.stripe.com/p/1" });
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "https://billing.stripe.com/p/1",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.stripe.com/v1/billing_portal/sessions",
    );
  });

  it("sends a shop with an incomplete subscription to the Portal too", async () => {
    const { db, shop } = await linkedWithoutStatus();
    await db
      .update(shopSubscriptions)
      .set({ stripeStatus: "incomplete" })
      .where(eq(shopSubscriptions.shopId, shop.id));
    stripeAnswers({ url: "https://billing.stripe.com/p/1" });
    await redirectedTo(() => startBillingCheckoutAction());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("billing_portal");
  });

  it("expires the Checkout another tab left open before opening its own", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    await db.insert(shopSubscriptions).values({ shopId: shop.id, stripeCustomerId: "cus_a" });
    await recordShopCheckoutSession(db, shop.id, { previous: null, sessionId: "cs_old" });
    const bodies = [
      { status: "open" },
      { status: "expired" },
      { id: "cs_new", url: "https://checkout.stripe.com/c/new" },
    ];
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }),
    );
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "https://checkout.stripe.com/c/new",
    );
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://api.stripe.com/v1/checkout/sessions/cs_old",
      "https://api.stripe.com/v1/checkout/sessions/cs_old/expire",
      "https://api.stripe.com/v1/checkout/sessions",
    ]);
    expect((await getShopSubscription(db, shop.id))?.stripeCheckoutSessionId).toBe("cs_new");
  });

  it("opens no second Checkout while the first one's payment is still on its way", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    await db.insert(shopSubscriptions).values({ shopId: shop.id, stripeCustomerId: "cus_a" });
    await recordShopCheckoutSession(db, shop.id, { previous: null, sessionId: "cs_paid" });
    stripeAnswers({ status: "complete" });
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis/settings/billing?notice=pending",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses when Stripe hands back a customer another shop already holds", async () => {
    const { db, owner, signIn } = await context();
    configure();
    signIn(owner);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-billing-action", timezone: "UTC" })
      .returning({ id: shops.id });
    await db
      .insert(shopSubscriptions)
      .values({ shopId: other?.id ?? "", stripeCustomerId: "cus_x" });
    stripeAnswers({ id: "cus_x" });
    expect(await redirectedTo(() => startBillingCheckoutAction())).toBe(
      "/shop/blue-mantis/settings/billing?notice=unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Cancel plan", () => {
  it("opens the Portal's cancel flow on the shop's own subscription, whatever the form says", async () => {
    const { db, shop, owner, signIn } = await context();
    configure();
    signIn(owner);
    stripeAnswers({ url: "https://billing.stripe.com/p/cancel" });
    await db.insert(shopSubscriptions).values({
      shopId: shop.id,
      stripeCustomerId: "cus_paid",
      stripeSubscriptionId: "sub_paid",
      stripeStatus: "active",
    });
    const form = new FormData();
    form.set("intent", "cancel");
    form.set("subscription", "sub_someone_else");
    expect(await redirectedTo(() => openBillingPortalAction(form))).toBe(
      "https://billing.stripe.com/p/cancel",
    );
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("customer")).toBe("cus_paid");
    expect(body.get("flow_data[subscription_cancel][subscription]")).toBe("sub_paid");
  });

  it("has nothing to open for a shop with no customer yet", async () => {
    const { owner, signIn } = await context();
    configure();
    signIn(owner);
    expect(await redirectedTo(() => openBillingPortalAction(new FormData()))).toBe(
      "/shop/blue-mantis/settings/billing?notice=unavailable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
