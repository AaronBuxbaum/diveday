import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * The "Units" card saves three settings behind one button, and only two of them
 * are ordinary staff work. Depth and water temperature are display-and-entry
 * preferences anyone on the crew may set; currency decides what a diver's card
 * is charged in, which is owner/manager work (H-14).
 *
 * The page hides the currency `<select>` from everyone else, but hiding a field
 * is not a gate — a hand-made form post carries whatever it likes. These tests
 * run the real action against a real seeded database with only the session and
 * Next's navigation primitives faked, and check the `shops` row after the
 * refusal rather than the notice alone: `setShopCurrency` has no gate of its
 * own and writes whatever it is handed.
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
const { saveUnitsAction } = await import("./actions");

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function unitsForm(values: { depthUnit?: string; temperatureUnit?: string; currency?: string }) {
  const formData = new FormData();
  formData.set("depthUnit", values.depthUnit ?? "feet");
  formData.set("temperatureUnit", values.temperatureUnit ?? "fahrenheit");
  if (values.currency !== undefined) formData.set("currency", values.currency);
  return formData;
}

async function unitsOf(db: AppDb, shopId: string) {
  const shop = await getShopById(db, shopId);
  if (!shop) throw new Error("seeded shop missing");
  return {
    depthUnit: shop.depthUnit,
    temperatureUnit: shop.temperatureUnit,
    currency: shop.currency,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saving the shop's units", () => {
  it("lets any staff member set depth and water temperature", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units_saved&saved=units`);
    expect(await unitsOf(db, shop.id)).toMatchObject({
      depthUnit: "feet",
      temperatureUnit: "fahrenheit",
    });
  });

  it("refuses a captain who posts a currency field the page never showed him", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "eur" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not_authorized`);
    // The whole submission drops, not just the currency: a staffer who posted
    // three values and got back "not authorized" should not have to guess which
    // two landed.
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("lets an owner set all three", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "eur" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units_saved&saved=units`);
    expect(await unitsOf(db, shop.id)).toMatchObject({
      depthUnit: "feet",
      temperatureUnit: "fahrenheit",
      currency: "eur",
    });
  });

  it("refuses an owner's unrecognized currency rather than coercing it to dollars", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "xyz" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units_invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("refuses a depth unit that is not one of the two", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ depthUnit: "fathoms" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units_invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });
});
