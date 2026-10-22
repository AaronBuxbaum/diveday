import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **Record payment, demo and real** (market sheet 2026-10-22, item 6). On a
 * demo shop, cash and the card machine are recorded locally and the Stripe
 * path is never called; a room charge stays refused there, with the demo
 * note. On a real shop nothing changes: the Stripe path records it. Which path
 * runs is decided by the shop row the action reads, never by the form.
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
vi.mock("@/lib/security-step-up", () => ({
  hasRequiredStepUp: vi.fn(async () => true),
  stepUpChallengeUrl: vi.fn(() => "/step-up"),
}));
vi.mock("@/features/integrations", () => ({ dispatchIntegrationsAfterResponse: vi.fn() }));
vi.mock("@/db/shop-activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/shop-activity")>();
  return { ...actual, recordShopActivity: vi.fn() };
});
vi.mock("@/db/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/orders")>();
  return {
    ...actual,
    recordPaymentOnOpenOrder: vi.fn(),
    recordDemoPaymentOnOpenOrder: vi.fn(),
  };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { recordDemoPaymentOnOpenOrder, recordPaymentOnOpenOrder } = await import("@/db/orders");
const { recordPaymentAction } = await import("./counter-actions");

const ORDER_ID = "00000000-0000-4000-8000-000000000001";

async function as({ demo }: { demo: boolean }) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(recordPaymentOnOpenOrder).mockReset();
  vi.mocked(recordDemoPaymentOnOpenOrder).mockReset();
  await db.update(shops).set({ isDemo: demo }).where(eq(shops.id, shop.id));
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { shop, personId, back: shopPath(shop.slug, "orders", ORDER_ID) };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("record payment on a demo shop", () => {
  it.each(["cash", "card_machine"] as const)(
    "records %s locally and never calls the Stripe path",
    async (collection) => {
      const { shop, personId, back } = await as({ demo: true });
      vi.mocked(recordDemoPaymentOnOpenOrder).mockResolvedValueOnce({
        ok: true,
        order: { id: ORDER_ID } as never,
      });
      expect(
        await redirectedTo(() => recordPaymentAction(form({ orderId: ORDER_ID, collection }))),
      ).toBe(noticeUrl(back, "payment-recorded-demo"));
      expect(recordDemoPaymentOnOpenOrder).toHaveBeenCalledWith(expect.anything(), {
        shopId: shop.id,
        orderId: ORDER_ID,
        actorPersonId: personId,
        collection,
      });
      expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
    },
  );

  it("refuses a room charge with the demo note, before either path", async () => {
    const { back } = await as({ demo: true });
    expect(
      await redirectedTo(() =>
        recordPaymentAction(
          form({ orderId: ORDER_ID, collection: "room_charge", roomNumber: "412" }),
        ),
      ),
    ).toBe(noticeUrl(back, "demo-disabled"));
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
    expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
  });

  it("refuses a method it does not know, before either path", async () => {
    const { back } = await as({ demo: true });
    expect(
      await redirectedTo(() =>
        recordPaymentAction(form({ orderId: ORDER_ID, collection: "stripe_invoice" })),
      ),
    ).toBe(noticeUrl(back, "demo-disabled"));
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
    expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
  });

  it("says it failed when the demo write refuses", async () => {
    const { back } = await as({ demo: true });
    vi.mocked(recordDemoPaymentOnOpenOrder).mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
    });
    expect(
      await redirectedTo(() =>
        recordPaymentAction(form({ orderId: ORDER_ID, collection: "cash" })),
      ),
    ).toBe(noticeUrl(back, "payment-record-failed"));
  });
});

describe("record payment on a real shop", () => {
  it("takes the Stripe path and never the demo one", async () => {
    const { back } = await as({ demo: false });
    vi.mocked(recordPaymentOnOpenOrder).mockResolvedValueOnce({
      ok: false,
      reason: "stripe_refused",
    });
    expect(
      await redirectedTo(() =>
        recordPaymentAction(form({ orderId: ORDER_ID, collection: "cash" })),
      ),
    ).toBe(noticeUrl(back, "payment-stripe-refused"));
    expect(recordPaymentOnOpenOrder).toHaveBeenCalledOnce();
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
  });
});
