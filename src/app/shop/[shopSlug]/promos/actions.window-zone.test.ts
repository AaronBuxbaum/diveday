import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * A code's window is typed in a `datetime-local` box and shown back in the
 * shop's own zone, so it has to be read in that zone: `new Date("2026-12-01T09:00")`
 * reads it in the server's, and a Honolulu shop's 9 AM start became 9 AM UTC.
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
vi.mock("@/db/shop-promos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/shop-promos")>();
  return { ...actual, createShopPromoCode: vi.fn(async () => ({ ok: true }) as const) };
});
vi.mock("../../../../features/accounts/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { createShopPromoCode } = await import("@/db/shop-promos");
const { requireStaffSession } = await import("../../../../features/accounts/session");
const { createPromoAction } = await import("./actions");

function promoForm(window: Record<string, string>) {
  const form = new FormData();
  form.set("code", "ZONE10");
  form.set("description", "");
  form.set("discount", "10");
  form.set("discountKind", "percent");
  form.set("scope", "all");
  form.set("maxRedemptions", "");
  for (const [key, value] of Object.entries(window)) form.set(key, value);
  return form;
}

async function signInOwnerOfHonoluluShop() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  await db.update(shops).set({ timezone: "Pacific/Honolulu" }).where(eq(shops.id, shop.id));
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  vi.mocked(createShopPromoCode).mockClear();
  return shop;
}

describe("a discount code's window", () => {
  it("is read in the shop's own zone", async () => {
    const shop = await signInOwnerOfHonoluluShop();
    await redirectedTo(() =>
      createPromoAction(promoForm({ startsAt: "2026-12-01T09:00", expiresAt: "2026-12-31T17:30" })),
    );
    const input = vi.mocked(createShopPromoCode).mock.calls[0]?.[1];
    // Honolulu is UTC-10 all year.
    expect(input?.startsAt?.toISOString()).toBe("2026-12-01T19:00:00.000Z");
    expect(input?.expiresAt?.toISOString()).toBe("2027-01-01T03:30:00.000Z");
    expect(input?.shopId).toBe(shop.id);
  });

  it("keeps an instant that already names its zone (the undo toast's)", async () => {
    await signInOwnerOfHonoluluShop();
    await redirectedTo(() =>
      createPromoAction(promoForm({ startsAt: "2026-12-01T19:00:00.000Z", expiresAt: "" })),
    );
    const input = vi.mocked(createShopPromoCode).mock.calls[0]?.[1];
    expect(input?.startsAt?.toISOString()).toBe("2026-12-01T19:00:00.000Z");
    expect(input?.expiresAt).toBeNull();
  });

  it("refuses a window that is not a time", async () => {
    await signInOwnerOfHonoluluShop();
    const to = await redirectedTo(() => createPromoAction(promoForm({ startsAt: "soon" })));
    expect(to).toContain("notice=invalid");
    expect(createShopPromoCode).not.toHaveBeenCalled();
  });
});
