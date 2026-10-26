import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { orders, people, shops } from "@/db/schema";
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
 * **Record payment, demo and real** (market sheet 2026-10-22, item 6; issue
 * #3030). Cash and the card machine are held eight seconds with Undo
 * (`holdCounterPaymentAction`) and recorded on release: locally on a demo
 * shop, where the Stripe path is never called, and through Stripe on a real
 * one. A room charge records on its confirm and stays refused on a demo, with
 * the demo note. Which path runs is decided by the shop row, never the form.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
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
const { holdCounterPaymentAction, recordRoomChargeAction } = await import("./counter-actions");
const { releaseHeldSendAction, undoHeldSendAction } = await import("@/app/actions/held-sends");

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
  const [guest] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Counter Guest", email: "counter-hold@example.com" })
    .returning();
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: guest.id,
      createdByPersonId: personId,
      currency: "usd",
      totalCents: 34_000,
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripeInvoiceId: `in_test_${crypto.randomUUID()}`,
    })
    .returning();
  return { shop, personId, orderId: order.id, back: shopPath(shop.slug, "orders", order.id) };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function holdAndRelease(orderId: string, collection: string) {
  const held = await holdCounterPaymentAction(form({ orderId, collection }));
  if (!held.ok) throw new Error(`hold refused: ${held.redirectTo}`);
  return { held, released: await releaseHeldSendAction(held.ticket.id) };
}

describe("record payment on a demo shop", () => {
  it.each(["cash", "card_machine"] as const)(
    "holds %s, records nothing until the release, then records it locally and never calls Stripe",
    async (collection) => {
      const { shop, personId, orderId, back } = await as({ demo: true });
      vi.mocked(recordDemoPaymentOnOpenOrder).mockResolvedValueOnce({
        ok: true,
        order: { id: orderId } as never,
      });
      const held = await holdCounterPaymentAction(form({ orderId, collection }));
      expect(held).toMatchObject({ ok: true, collection });
      // The tap recorded nothing.
      expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
      if (!held.ok) throw new Error("expected a hold");
      const released = await releaseHeldSendAction(held.ticket.id);
      expect(released).toMatchObject({
        status: "done",
        outcome: { redirectTo: noticeUrl(back, "payment-recorded-demo") },
      });
      expect(recordDemoPaymentOnOpenOrder).toHaveBeenCalledWith(expect.anything(), {
        shopId: shop.id,
        orderId,
        actorPersonId: personId,
        collection,
        // The tap's time, not the release's (review of PR 3061).
        paidAt: expect.any(Date),
      });
      expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
    },
  );

  it("records nothing on Undo, and the release finds nothing to record", async () => {
    const { orderId } = await as({ demo: true });
    const held = await holdCounterPaymentAction(form({ orderId, collection: "cash" }));
    if (!held.ok) throw new Error("expected a hold");
    expect(await undoHeldSendAction(held.ticket.id)).toBe(true);
    expect(await releaseHeldSendAction(held.ticket.id)).toEqual({ status: "gone" });
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
    expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
  });

  it("refuses a room charge with the demo note, before either path", async () => {
    const { orderId, back } = await as({ demo: true });
    expect(
      await redirectedTo(() =>
        recordRoomChargeAction(form({ orderId, collection: "room_charge", roomNumber: "412" })),
      ),
    ).toBe(noticeUrl(back, "demo-disabled"));
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
    expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
  });

  it("holds no method but cash or the card machine", async () => {
    const { orderId, back } = await as({ demo: true });
    for (const collection of ["stripe_invoice", "room_charge", ""]) {
      expect(await holdCounterPaymentAction(form({ orderId, collection }))).toEqual({
        ok: false,
        redirectTo: noticeUrl(back, "payment-record-failed"),
      });
    }
  });

  it("says it failed when the demo write refuses", async () => {
    const { orderId, back } = await as({ demo: true });
    vi.mocked(recordDemoPaymentOnOpenOrder).mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
    });
    const { released } = await holdAndRelease(orderId, "cash");
    expect(released).toMatchObject({
      outcome: { redirectTo: noticeUrl(back, "payment-record-failed") },
    });
  });
});

describe("record payment on a real shop", () => {
  it("takes the Stripe path at the release and never the demo one", async () => {
    const { orderId, back } = await as({ demo: false });
    vi.mocked(recordPaymentOnOpenOrder).mockResolvedValueOnce({
      ok: false,
      reason: "stripe_refused",
    });
    const { released } = await holdAndRelease(orderId, "cash");
    expect(released).toMatchObject({
      outcome: { redirectTo: noticeUrl(back, "payment-stripe-refused") },
    });
    expect(recordPaymentOnOpenOrder).toHaveBeenCalledOnce();
    expect(recordDemoPaymentOnOpenOrder).not.toHaveBeenCalled();
  });

  it("records a room charge on its confirm, and only a room charge", async () => {
    const { orderId, back } = await as({ demo: false });
    expect(
      await redirectedTo(() => recordRoomChargeAction(form({ orderId, collection: "cash" }))),
    ).toBe(noticeUrl(back, "payment-record-failed"));
    expect(recordPaymentOnOpenOrder).not.toHaveBeenCalled();
    vi.mocked(recordPaymentOnOpenOrder).mockResolvedValueOnce({
      ok: false,
      reason: "stripe_refused",
    });
    expect(
      await redirectedTo(() =>
        recordRoomChargeAction(form({ orderId, collection: "room_charge", roomNumber: "412" })),
      ),
    ).toBe(noticeUrl(back, "payment-stripe-refused"));
    expect(recordPaymentOnOpenOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collection: "room_charge", room: { number: "412", hotel: null } }),
    );
  });
});
