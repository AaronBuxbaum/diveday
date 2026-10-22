import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { PaymentsSetupCard } from "./_components/PaymentsSetupCard";

const ctx = fileScopedShopContext();

// The page is invoked directly, outside Next's request scope, so the three
// things that only exist inside one are stubbed (as in ./page.test.tsx).
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const OrdersIndexPage = (await import("./page")).default;

/** The Orders index as the seeded owner sees it, after `prepare` has run. */
async function ownerOrders(prepare?: (db: AppDb, shopId: string) => Promise<void>) {
  const db = ctx.db;
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  if (prepare) await prepare(db, shop.id);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: owner.fullName,
      email: "staff@demo.invalid",
      roles: owner.roles,
    },
  });
  return OrdersIndexPage({
    params: Promise.resolve({ shopSlug: shop.slug }),
    searchParams: Promise.resolve({}),
  });
}

/**
 * **The demo opens on its orders, not on a setup ask** (fourth review, item
 * 53). "Take payments with DiveDay" stood above 156 paid orders on a shop
 * presented as running; Billing already says a demo is never billed.
 */
describe("the payments setup card", () => {
  it("is not shown on the demo shop", async () => {
    expect(findElements(await ownerOrders(), PaymentsSetupCard)).toHaveLength(0);
  });

  it("asks a real shop with no payments connected", async () => {
    const page = await ownerOrders(async (db, shopId) => {
      await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shopId));
    });
    expect(findElements(page, PaymentsSetupCard)).toHaveLength(1);
  });
});
