import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { redirectedTo } from "@/test/staff-session";

/**
 * **No dead ends** (Aaron, 2026-10-23): a direct URL to a staff page whose
 * Features switch is off lands somewhere sensible with no error, and nothing
 * the page held is deleted. One case per switched-off page.
 */
const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
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

type Page = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

type Column = keyof typeof shops.$inferInsert;

/** Signs the owner in with these switches' columns off, and opens the page. */
async function openSwitchedOff(
  off: Column | readonly Column[],
  load: () => Promise<{ default: unknown }>,
  params: Record<string, string> = {},
) {
  const db: AppDb = ctx.db;
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const columns: readonly Column[] = typeof off === "string" ? [off] : off;
  const set = (on: boolean) => Object.fromEntries(columns.map((column) => [column, on]));
  await db.update(shops).set(set(false)).where(eq(shops.id, shop.id));
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  vi.mocked(getDb).mockResolvedValue(db);
  authModule.auth.mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: owner.fullName,
      email: "staff@demo.invalid",
      roles: owner.roles,
    },
  });
  const page = (await load()).default as Page;
  try {
    return await redirectedTo(() =>
      page({
        params: Promise.resolve({ shopSlug: shop.slug, ...params }),
        searchParams: Promise.resolve({}),
      }),
    );
  } finally {
    await db.update(shops).set(set(true)).where(eq(shops.id, shop.id));
  }
}

const SOME_ID = "00000000-0000-4000-8000-000000000000";

describe("a switched-off staff page", () => {
  it("Lost and found lands on the schedule", async () => {
    expect(await openSwitchedOff("lostFoundEnabled", () => import("./lost-found/page"))).toBe(
      "/shop/blue-mantis/schedule/board",
    );
  });

  it.each([
    ["the bench", () => import("./gear/work-orders/page"), {}],
    ["a new ticket", () => import("./gear/work-orders/new/page"), {}],
    ["a ticket", () => import("./gear/work-orders/[workOrderId]/page"), { workOrderId: SOME_ID }],
    [
      "a claim tag",
      () => import("./gear/work-orders/[workOrderId]/tag/page"),
      { workOrderId: SOME_ID },
    ],
  ])("gear servicing: %s lands on the gear register", async (_name, load, params) => {
    expect(await openSwitchedOff("workOrdersEnabled", load, params)).toBe("/shop/blue-mantis/gear");
  });

  it("the counter card lands on Settings while counter sign-up is off", async () => {
    expect(
      await openSwitchedOff("selfRegistrationEnabled", () => import("./print/counter-card/page")),
    ).toBe("/shop/blue-mantis/settings");
  });

  // The old packages address lands on Discounts whatever the switch says
  // (visual review 2026-10-24, A26); Discounts gates itself.
  it("Dive packages lands on Discounts", async () => {
    expect(
      await openSwitchedOff("divePackagesEnabled", () => import("./promos/packages/page")),
    ).toBe("/shop/blue-mantis/promos#dive-packages");
  });

  it("Discounts lands on Orders once codes, deals and packages are all off", async () => {
    expect(
      await openSwitchedOff(
        ["promoCodesEnabled", "lastMinuteListEnabled", "divePackagesEnabled"],
        () => import("./promos/page"),
      ),
    ).toBe("/shop/blue-mantis/orders");
  });
});
