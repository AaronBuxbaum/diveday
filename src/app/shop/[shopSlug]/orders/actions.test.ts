import { describe, expect, it, vi } from "vitest";
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
 * The Orders index's refund of money paid after a checkout closed (issue
 * #2335). The gate is the contract: owner/manager work re-read from live roles,
 * and the posted id narrowed before it reaches the database.
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
vi.mock("@/db/checkouts-paid-after-close", () => ({
  refundPaidAfterCloseCheckout: vi.fn(async () => ({ status: "refunded", amountCents: 100 })),
}));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { refundPaidAfterCloseCheckout } = await import("@/db/checkouts-paid-after-close");
const { refundPaidAfterCloseAction } = await import("./actions");

const CHECKOUT_ID = "00000000-0000-4000-8000-000000000002";

async function as(email: string) {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { shopId: shop.id, back: shopPath(shop.slug, "orders") };
}

function form(checkoutId: string) {
  const data = new FormData();
  data.set("checkoutId", checkoutId);
  return data;
}

describe("refundPaidAfterCloseAction", () => {
  it("refuses a captain before any refund", async () => {
    const { back } = await as(SEEDED_CAPTAIN_EMAIL);
    expect(await redirectedTo(() => refundPaidAfterCloseAction(form(CHECKOUT_ID)))).toBe(
      noticeUrl(back, "not-authorized-refund"),
    );
    expect(refundPaidAfterCloseCheckout).not.toHaveBeenCalled();
  });

  it("refunds an owner's checkout in the owner's own shop", async () => {
    const { shopId, back } = await as(SEEDED_OWNER_EMAIL);
    expect(await redirectedTo(() => refundPaidAfterCloseAction(form(CHECKOUT_ID)))).toBe(
      noticeUrl(back, "paid-after-close-refunded"),
    );
    expect(refundPaidAfterCloseCheckout).toHaveBeenCalledWith(
      expect.anything(),
      shopId,
      CHECKOUT_ID,
    );
  });

  it("never sends a malformed id to the database", async () => {
    vi.mocked(refundPaidAfterCloseCheckout).mockClear();
    const { back } = await as(SEEDED_OWNER_EMAIL);
    expect(await redirectedTo(() => refundPaidAfterCloseAction(form("nope")))).toBe(
      noticeUrl(back, "paid-after-close-failed"),
    );
    expect(refundPaidAfterCloseCheckout).not.toHaveBeenCalled();
  });
});
