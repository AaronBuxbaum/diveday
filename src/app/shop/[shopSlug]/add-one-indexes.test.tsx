import { describe, expect, it, vi } from "vitest";
import { AddPanel } from "@/components/AddPanel";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { RegisterRentOutPanel } from "./gear/rentals/_components/RentOutPanel";
import { OrdersAddPanel } from "./orders/_components/NewOrderPanel";

/*
 * "Add one" is one grammar (#2737): each object's index opens its add panel on
 * `?add=` and draws nothing extra without it. The pages are invoked directly,
 * as in orders/page.test.tsx, with only the db handle, better-auth and request
 * headers stubbed.
 */
const ctx = fileScopedShopContext();

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

const SHOP_SLUG = "blue-mantis";

async function signInOwner() {
  const db: AppDb = ctx.db;
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  // Orders opens its panel only for a shop that can take payment.
  const account = await upsertShopStripeAccount(db, shop.id, "acct_unit_test");
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: SHOP_SLUG,
      name: owner.fullName,
      email: "staff@demo.invalid",
      roles: owner.roles,
    },
  });
}

type IndexPage = (props: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

/** The wrappers that draw the shared shell, called so the shell itself is in the tree. */
const WRAPPERS = new Set<unknown>([OrdersAddPanel, RegisterRentOutPanel]);

function expandWrappers(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expandWrappers);
  if (node === null || typeof node !== "object" || !("props" in node)) return node;
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (WRAPPERS.has(element.type)) {
    return expandWrappers((element.type as (props: unknown) => unknown)(element.props));
  }
  return {
    ...element,
    props: { ...element.props, children: expandWrappers(element.props.children) },
  };
}

async function panelsOn(load: () => Promise<{ default: unknown }>, add?: string) {
  await signInOwner();
  const Page = (await load()).default as IndexPage;
  const tree = expandWrappers(
    await Page({
      params: Promise.resolve({ shopSlug: SHOP_SLUG }),
      searchParams: Promise.resolve(add ? { add } : {}),
    }),
  );
  return findElements<{ open: boolean; title: string; closeHref: string }>(tree, AddPanel);
}

const INDEXES = [
  { name: "divers", add: "1", load: () => import("./divers/page"), path: "/divers" },
  { name: "orders", add: "1", load: () => import("./orders/page"), path: "/orders" },
  { name: "dive sites", add: "1", load: () => import("./dive-sites/page"), path: "/dive-sites" },
  { name: "the register", add: "rental", load: () => import("./gear/page"), path: "/gear" },
  {
    name: "the repair bench",
    add: "1",
    load: () => import("./gear/work-orders/page"),
    path: "/gear/work-orders",
  },
];

describe.each(INDEXES)("$name", ({ add, load, path }) => {
  it(`opens its add panel on ?add=${add}, closing back to the index`, async () => {
    const [panel] = await panelsOn(load, add);
    expect(panel?.props.open).toBe(true);
    expect(panel?.props.closeHref).toBe(`/shop/${SHOP_SLUG}${path}`);
  });

  it("keeps the panel shut without it", async () => {
    const panels = await panelsOn(load);
    expect(panels.every((panel) => !panel.props.open)).toBe(true);
  });
});
