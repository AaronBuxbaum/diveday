import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { shopPromoCodes } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * Discount codes move real money off the shop's own Stripe account, so they are
 * owner/manager work (H-14, ADR 20260724-role-authorization). `promos/page.tsx`
 * hides the controls from everyone else, but hiding is not a gate — a form post
 * from a captain's browser reaches these actions all the same. These tests run
 * the real actions against a real seeded shop and pin both halves of the answer:
 * the refusal notice, *and* that the promo row is untouched afterwards.
 *
 * There is no re-check below `promos/actions.ts` — `setShopPromoEnabled` and
 * `deleteShopPromoCode` write whatever they are handed. `requirePromoManager()`
 * is the only thing standing between a captain and the shop's pricing.
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

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { deletePromoAction, setPromoEnabledAction } = await import("./actions");

/** The standing "REEF10" code seed.ts gives the demo shop. */
async function seededPromo(db: AppDb, shopId: string) {
  const [promo] = await db
    .select()
    .from(shopPromoCodes)
    .where(eq(shopPromoCodes.shopId, shopId))
    .orderBy(shopPromoCodes.code)
    .limit(1);
  if (!promo) throw new Error("seeded shop has no promo codes");
  return promo;
}

async function promoById(db: AppDb, promoId: string) {
  const [promo] = await db.select().from(shopPromoCodes).where(eq(shopPromoCodes.id, promoId));
  return promo ?? null;
}

/** Seeded shop, its promo row, and both actors, with `getDb()` pointed at it. */
async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const promo = await seededPromo(db, shop.id);
  return {
    db,
    shop,
    promo,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function withPromo(promoId: string, extra: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("promoId", promoId);
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("turning a discount code on or off", () => {
  it("refuses a captain — a discount code is the shop's pricing, not deck work", async () => {
    const { db, shop, promo, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      setPromoEnabledAction(withPromo(promo.id, { enable: "false" })),
    );

    expect(to).toBe(`/shop/${shop.slug}/promos?notice=not-authorized`);
    // The refusal is only worth anything if the row survived it.
    expect((await promoById(db, promo.id))?.status).toBe(promo.status);
  });

  it("lets an owner disable the code", async () => {
    const { db, shop, promo, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      setPromoEnabledAction(withPromo(promo.id, { enable: "false" })),
    );

    expect(to).toBe(`/shop/${shop.slug}/promos?notice=disabled`);
    expect((await promoById(db, promo.id))?.status).toBe("disabled");
  });
});

describe("deleting a discount code", () => {
  it("refuses a captain and leaves the code in place", async () => {
    const { db, shop, promo, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => deletePromoAction(withPromo(promo.id)));

    expect(to).toBe(`/shop/${shop.slug}/promos?notice=not-authorized`);
    expect(await promoById(db, promo.id)).not.toBeNull();
  });
});

describe("the roles the gate trusts", () => {
  it("ignores an owner claim in the session and asks the database instead", async () => {
    // The session is a JWT minted at sign-in, so its roles can be stale — a
    // demoted staff member keeps an owner claim until they sign in again — and a
    // forged one is not a wild scenario for a token the client holds. Sal is a
    // captain in `person_roles` no matter what the token says, and
    // `canPersonManagePaymentSettings` reads `person_roles`.
    const { db, shop, promo, captain } = await context();
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: shop.id,
        shopSlug: shop.slug,
        personId: captain,
        roles: ["owner", "manager"],
      }),
    );

    const to = await redirectedTo(() =>
      setPromoEnabledAction(withPromo(promo.id, { enable: "false" })),
    );

    expect(to).toBe(`/shop/${shop.slug}/promos?notice=not-authorized`);
    expect((await promoById(db, promo.id))?.status).toBe(promo.status);
  });
});
