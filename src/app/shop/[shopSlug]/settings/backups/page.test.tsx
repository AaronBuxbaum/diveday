import { eq } from "drizzle-orm";
import { Children, isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { shopBackupDeliveries } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());
const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const Page = (await import("./page")).default;

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : "";
    })
    .join(" ");
}

it.each(["test-delivered", "disconnected"])(
  "a forged %s query cannot claim successful delivery or removal",
  async (notice) => {
    const db = ctx.db;
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");
    const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db.delete(shopBackupDeliveries).where(eq(shopBackupDeliveries.shopId, shop.id));
    vi.mocked(getDb).mockResolvedValue(db);
    authModule.auth.mockResolvedValue({
      user: {
        personId,
        shopId: shop.id,
        shopSlug: shop.slug,
        name: "Dana Reyes",
        email: SEEDED_OWNER_EMAIL,
        roles: ["owner"],
      },
    });
    const page = await Page({
      params: Promise.resolve({ shopSlug: shop.slug }),
      searchParams: Promise.resolve({ notice }),
    });
    expect(text(page)).not.toContain("Test delivery landed");
    expect(text(page)).not.toContain("Backup destination removed");
  },
);
