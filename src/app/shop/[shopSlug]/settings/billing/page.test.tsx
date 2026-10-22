import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { shopSubscriptions, shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { STAFF_MESSAGES } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();

// Same mocking shape as ../whatsapp/page.test.tsx: the page is invoked
// directly, so the db handle, better-auth and request headers are stubbed.
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
const BillingSettingsPage = (await import("./page")).default;
const { openBillingPortalAction, startBillingCheckoutAction } = await import("./actions");

const COPY = STAFF_MESSAGES["en-US"].billing;

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure() {
  vi.stubEnv("BILLING_STRIPE_SECRET_KEY", "sk_test_billing");
  vi.stubEnv("BILLING_STRIPE_WEBHOOK_SECRET", "whsec_billing");
  vi.stubEnv("BILLING_STRIPE_PRICE_ID", "price_monthly");
}

async function render(
  setup: (db: AppDb, shopId: string) => Promise<void> = async () => {},
  searchParams: { notice?: string } = {},
) {
  const db = ctx.db;
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  await setup(db, shop.id);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(authModule.auth).mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: SEEDED_OWNER_EMAIL,
      roles: ["owner", "manager"],
    },
  });
  const tree = await BillingSettingsPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve(searchParams),
  });
  const [card] = findElements<{ description?: unknown; actions?: unknown }>(tree, SectionCard);
  const forms = findElements<{ action?: unknown }>(tree, "form");
  const lines = findElements<{ children?: unknown }>(tree, "p").map((p) => p.props.children);
  return { card: card as ReactElement<{ description?: unknown; actions?: unknown }>, forms, lines };
}

const notDemo = async (db: AppDb, shopId: string) => {
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shopId));
};

describe("the Billing page before billing is turned on", () => {
  it("says so, and offers no door to Stripe", async () => {
    const { card, forms } = await render(notDemo);
    expect(card.props.description).toBe(COPY.notConfigured);
    expect(forms).toHaveLength(0);
  });

  it("still states the shop's own standing, which is DiveDay's fact rather than Stripe's", async () => {
    const { card } = await render(async (db, shopId) => {
      await notDemo(db, shopId);
      await db.insert(shopSubscriptions).values({ shopId, freeTermEndsOn: "2099-04-01" });
    });
    const [badge] = findElements<{ children?: unknown }>(card.props.actions, Badge);
    expect(String(badge?.props.children)).toMatch(/^Free through /);
  });
});

describe("the Billing page once billing is on", () => {
  it("offers Add a card to a shop with no subscription", async () => {
    configure();
    const { card, forms } = await render(notDemo);
    expect(card.props.description).toBeUndefined();
    expect(forms.map((form) => form.props.action)).toEqual([startBillingCheckoutAction]);
  });

  it("offers Manage billing and Cancel plan to a shop that pays", async () => {
    configure();
    const { forms } = await render(async (db, shopId) => {
      await notDemo(db, shopId);
      await db.insert(shopSubscriptions).values({
        shopId,
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_paid",
        stripeStatus: "active",
        currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
      });
    });
    expect(forms.map((form) => form.props.action)).toEqual([
      openBillingPortalAction,
      openBillingPortalAction,
    ]);
  });

  it("drops Cancel plan once the owner has already canceled at period end", async () => {
    configure();
    const { forms } = await render(async (db, shopId) => {
      await notDemo(db, shopId);
      await db.insert(shopSubscriptions).values({
        shopId,
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_paid",
        stripeStatus: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
      });
    });
    expect(forms).toHaveLength(1);
  });

  it("waits for Stripe after Checkout's return instead of offering the card again", async () => {
    configure();
    const { forms, lines } = await render(notDemo, { notice: "card-added" });
    expect(forms).toHaveLength(0);
    expect(lines).toContain(COPY.waiting);
  });

  it("waits for Stripe while a linked subscription has no status yet", async () => {
    configure();
    const { forms, lines } = await render(async (db, shopId) => {
      await notDemo(db, shopId);
      await db.insert(shopSubscriptions).values({
        shopId,
        stripeCustomerId: "cus_paid",
        stripeSubscriptionId: "sub_linked",
      });
    });
    expect(forms).toHaveLength(0);
    expect(lines).toContain(COPY.waiting);
  });

  it("never offers a demo shop a card", async () => {
    configure();
    const { card, forms } = await render();
    expect(card.props.description).toBe(COPY.demo);
    expect(forms).toHaveLength(0);
  });
});

describe("the Billing page's plan (ADR 20261022-pricing-ab-test)", () => {
  const percentShop = async (db: AppDb, shopId: string) => {
    await notDemo(db, shopId);
    await db.insert(shopSubscriptions).values({
      shopId,
      pricingPlan: "percent_of_volume",
      pricingPlanSource: "assigned",
      assignedPricingPlan: "percent_of_volume",
    });
  };
  const configurePercent = () => {
    configure();
    vi.stubEnv("PRICING_TEST", "on");
    vi.stubEnv("BILLING_STRIPE_PERCENT_PRICE_ID", "price_metered");
    vi.stubEnv("BILLING_STRIPE_PERCENT_METER_EVENT", "diveday_fee_cents");
  };

  it("states today's flat price while the test is off, whatever arm is stored", async () => {
    configure();
    const { lines } = await render(percentShop);
    expect(lines).toContain("DiveDay, $99 a month");
  });

  it("states the percent plan, this month's volume and fee, in en-US", async () => {
    configurePercent();
    const { lines, forms } = await render(percentShop);
    expect(lines).toContain("DiveDay, 3% of card money taken through DiveDay");
    expect(lines).toContain(COPY.plan.thisMonth);
    expect(forms.map((form) => form.props.action)).toEqual([startBillingCheckoutAction]);
  });

  it("states a base fee when the percent plan carries one", async () => {
    configurePercent();
    vi.stubEnv("PRICING_PERCENT_MONTHLY_CENTS", "2900");
    const { lines } = await render(percentShop);
    expect(lines).toContain("DiveDay, 3% of card money taken through DiveDay plus $29 a month");
  });

  it("states the percent plan in es-ES", async () => {
    configurePercent();
    const { lines } = await render(async (db, shopId) => {
      await percentShop(db, shopId);
      await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shopId));
    });
    expect(
      lines
        .map(String)
        .some((line) => /^DiveDay, el 3\s?% del dinero cobrado con tarjeta/.test(line)),
    ).toBe(true);
    expect(lines).toContain(STAFF_MESSAGES["es-ES"].billing.plan.thisMonth);
  });

  it("offers no card while the percent plan's Stripe side is not configured", async () => {
    configure();
    vi.stubEnv("PRICING_TEST", "on");
    const { card, forms } = await render(percentShop);
    expect(card.props.description).toBe(COPY.plan.percentNotConfigured);
    expect(forms).toHaveLength(0);
  });
});
