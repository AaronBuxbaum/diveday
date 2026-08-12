import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { paymentOperationIntents } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededTestDb } from "@/test/db";
import { ariaLabelsIn } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { demoteOwnerToManager } from "@/test/staff-session";

// Same mocking shape as ../settings/SettingsPage.test.tsx: the page is invoked
// directly, outside Next's request scope, so the three things that only exist
// inside one (the db handle, next-auth, and request headers) are stubbed and
// nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const OrdersIndexPage = (await import("./page")).default;

const SHOP_SLUG = "blue-mantis";

/** A session for the seeded staff member who really holds `role`, roles and all. */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: Session }> {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  return {
    db,
    session: {
      user: {
        personId: member.personId,
        shopId: shop.id,
        shopSlug: SHOP_SLUG,
        name: member.fullName,
        roles: member.roles,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

async function renderOrders(role: Role, seed?: (db: AppDb, session: Session) => Promise<void>) {
  const { db, session } = await sessionFor(role);
  if (seed) await seed(db, session);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return OrdersIndexPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve({}),
  });
}

/**
 * An intent that started long enough ago to count as never having resolved.
 * Anchored to `nowDate()`, not the wall clock: the unit-test harness freezes
 * `DIVEDAY_CLOCK`, and `listStuckPaymentOperations` measures staleness against
 * that frozen instant — a real `Date.now()` here is a full fortnight in its
 * future and reads as an operation that started moments ago.
 */
async function stickAnOperation(db: AppDb, session: Session) {
  await db.insert(paymentOperationIntents).values({
    shopId: session.user.shopId,
    kind: "invoice",
    status: "started",
    stripeObjectId: "in_stuck",
    startedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
  });
}

/*
 * The stuck-payment-operations panel, which moved here from the monthly report:
 * reconciling an unconfirmed Stripe call is order work, not a report. What is
 * worth pinning down is the rendering condition and the gate that came with it.
 */
const PANEL = "Payments that need a check";

describe("the stuck-payment-operations panel", () => {
  it("renders nothing when there is nothing to reconcile", async () => {
    // The calm state: an empty queue is nothing on screen, not an empty table.
    // (The seed's one intent is `succeeded`, so this is the ordinary case.)
    expect(ariaLabelsIn(await renderOrders("owner"))).not.toContain(PANEL);
  });

  it("shows an unconfirmed operation to an owner", async () => {
    expect(ariaLabelsIn(await renderOrders("owner", stickAnOperation))).toContain(PANEL);
  });

  it("shows it to a manager too — the same role set the reports gate had", async () => {
    // The panel left `canPersonViewShopReports` for
    // `canPersonManagePaymentSettings`. Both are `isOwnerOrManager`, so the
    // move must not have cost a manager the visibility they already had. The
    // seed's only manager is also the owner (`src/db/seed-cast.ts`), so the
    // owner role is dropped first — the gate is DB-checked, so the demotion is
    // what the page sees.
    const element = await renderOrders("manager", async (db, session) => {
      await demoteOwnerToManager(db, session.user.personId);
      await stickAnOperation(db, session);
    });
    expect(ariaLabelsIn(element)).toContain(PANEL);
  });

  it("hides it from a divemaster, who can read orders but not reconcile them", async () => {
    // Reading the orders index stays open to every staff role — this panel does
    // not, which is the one thing that could have gone wrong in moving a
    // gated section onto an ungated page.
    expect(ariaLabelsIn(await renderOrders("divemaster", stickAnOperation))).not.toContain(PANEL);
  });
});
