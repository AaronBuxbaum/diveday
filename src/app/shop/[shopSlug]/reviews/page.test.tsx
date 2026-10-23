import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * **Reviews switched off** (the Features page): the Inbox tab and ⌘K entry are
 * gone (`feature-coverage.ts`), and a direct URL lands on the inbox with no
 * error. A diver's private pulse is not a review, so the page stays open for
 * a reader who may act on one while any is open.
 */
const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/db/recap-pulses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap-pulses")>();
  return { ...actual, listOpenRecapPulses: vi.fn(async () => []) };
});

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const { listOpenRecapPulses } = await import("@/db/recap-pulses");
const ReviewsPage = (await import("./page")).default;

async function open(role: Role, reviewsEnabled: boolean) {
  const db: AppDb = ctx.db;
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  await db.update(shops).set({ reviewsEnabled }).where(eq(shops.id, shop.id));
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  vi.mocked(getDb).mockResolvedValue(db);
  authModule.auth.mockResolvedValue({
    user: {
      personId: member.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: member.fullName,
      email: "staff@demo.invalid",
      roles: member.roles,
    },
  });
  return ReviewsPage({
    params: Promise.resolve({ shopSlug: shop.slug }),
    searchParams: Promise.resolve({}),
  });
}

describe("the Reviews page with reviews switched off", () => {
  it("opens while reviews are on", async () => {
    await expect(open("owner", true)).resolves.toBeTruthy();
  });

  it("redirects to the inbox when no private pulse waits", async () => {
    await expect(open("owner", false)).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("stays open for an owner while a private pulse waits, never for the crew", async () => {
    // The door's own question answers one open pulse; the page's list is left empty.
    vi.mocked(listOpenRecapPulses).mockResolvedValueOnce([{} as never]);
    await expect(open("owner", false)).resolves.toBeTruthy();
    vi.mocked(listOpenRecapPulses).mockResolvedValueOnce([{} as never]);
    await expect(open("divemaster", false)).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
