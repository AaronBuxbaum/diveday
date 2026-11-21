import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * A crew member who posts a purchase refund is told they are not authorized,
 * not that the form was invalid, and is not sent through a step-up challenge
 * for a refund the store would refuse anyway.
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
vi.mock("../../../../features/accounts/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../features/accounts/session");
const { recordPurchaseRefundAction } = await import("./purchase-actions");

const ORDER_ID = "00000000-0000-4000-8000-0000000000a1";

function refundForm(): FormData {
  const form = new FormData();
  form.set("orderId", ORDER_ID);
  form.set("attemptId", "00000000-0000-4000-8000-0000000000b2");
  form.set("expectedRefundedCents", "0");
  form.set("currency", "usd");
  form.set("amount", "5.00");
  form.set("reason", "Wrong size");
  return form;
}

async function signInAs(email: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return shop;
}

describe("recordPurchaseRefundAction", () => {
  it("tells a captain they are not authorized, before any step-up challenge", async () => {
    const shop = await signInAs(SEEDED_CAPTAIN_EMAIL);

    const to = await redirectedTo(() => recordPurchaseRefundAction(refundForm()));

    expect(to).toBe(`/shop/${shop.slug}/orders/${ORDER_ID}?notice=not-authorized`);
  });

  it("sends an owner on to the step-up challenge, not to a refusal", async () => {
    const shop = await signInAs(SEEDED_OWNER_EMAIL);

    const to = await redirectedTo(() => recordPurchaseRefundAction(refundForm()));

    expect(to).not.toContain("not-authorized");
    expect(to).toContain(`/shop/${shop.slug}`);
  });

  it("still calls a malformed form invalid", async () => {
    const shop = await signInAs(SEEDED_OWNER_EMAIL);
    const form = refundForm();
    form.set("orderId", "nope");

    const to = await redirectedTo(() => recordPurchaseRefundAction(form));

    expect(to).toBe(`/shop/${shop.slug}/orders?notice=purchase-refund-invalid`);
  });
});
