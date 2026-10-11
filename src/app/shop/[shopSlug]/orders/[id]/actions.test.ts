import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The order page's three Stripe-invoice doors, which lived inline in `page.tsx` until they moved
 * here. The gates are the contract: refunding is owner/manager work re-read from live roles, and a
 * demo shop never reaches Stripe with its fabricated invoice ids.
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
vi.mock("@/db/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/orders")>();
  return {
    ...actual,
    refreshOrderStatus: vi.fn(),
    voidOrder: vi.fn(),
    refundOrder: vi.fn(),
  };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { refreshOrderStatus, refundOrder, voidOrder } = await import("@/db/orders");
const { refreshAction, refundAction, voidAction } = await import("./actions");

const ORDER_ID = "00000000-0000-4000-8000-000000000001";

async function as(email: string, { demo }: { demo: boolean }) {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  await db.update(shops).set({ isDemo: demo }).where(eq(shops.id, shop.id));
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { back: shopPath(shop.slug, "orders", ORDER_ID) };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("the order page's Stripe doors on a demo shop", () => {
  it("refuses refresh and void before any Stripe call", async () => {
    const { back } = await as(SEEDED_OWNER_EMAIL, { demo: true });
    expect(await redirectedTo(() => refreshAction(form({ orderId: ORDER_ID })))).toBe(
      noticeUrl(back, "demo-disabled"),
    );
    expect(await redirectedTo(() => voidAction(form({ orderId: ORDER_ID })))).toBe(
      noticeUrl(back, "demo-disabled"),
    );
    expect(refreshOrderStatus).not.toHaveBeenCalled();
    expect(voidOrder).not.toHaveBeenCalled();
  });

  it("refuses an owner's refund before any Stripe call", async () => {
    const { back } = await as(SEEDED_OWNER_EMAIL, { demo: true });
    expect(await redirectedTo(() => refundAction(form({ orderId: ORDER_ID })))).toBe(
      noticeUrl(back, "demo-disabled"),
    );
    expect(refundOrder).not.toHaveBeenCalled();
  });
});

describe("refunding", () => {
  it("is refused to crew against live roles, before the demo guard", async () => {
    const { back } = await as(SEEDED_CAPTAIN_EMAIL, { demo: false });
    expect(await redirectedTo(() => refundAction(form({ orderId: ORDER_ID })))).toBe(
      noticeUrl(back, "not-authorized"),
    );
    expect(refundOrder).not.toHaveBeenCalled();
  });

  it("refuses a typed amount that is not a number", async () => {
    const { back } = await as(SEEDED_OWNER_EMAIL, { demo: false });
    expect(
      await redirectedTo(() => refundAction(form({ orderId: ORDER_ID, amountMajor: "ten" }))),
    ).toBe(noticeUrl(back, "refund-invalid-amount"));
    expect(refundOrder).not.toHaveBeenCalled();
  });

  it("names the outcome refundOrder returns", async () => {
    const { back } = await as(SEEDED_OWNER_EMAIL, { demo: false });
    vi.mocked(refundOrder).mockResolvedValueOnce({ status: "in_progress" } as never);
    expect(await redirectedTo(() => refundAction(form({ orderId: ORDER_ID })))).toBe(
      noticeUrl(back, "refund-in-progress"),
    );
  });
});
