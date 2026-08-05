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
const {
  saveAddressAction,
  saveDockCallAction,
  savePackingAction,
  saveTimezoneAction,
  saveUnitsAction,
} = await import("./actions");

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
  it("refuses a captain outright — settings are owner/manager work now", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not_authorized`);
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

/**
 * Hiding the settings page from the daily crew is a courtesy, never the gate.
 * A server action is a POST endpoint whose id ships to any browser that has
 * ever rendered the form, so a demoted staffer — or anyone who kept an old tab
 * open — could still post to it. Every mutation re-checks live roles, and each
 * test below asserts the *stored row* after the refusal, not the notice alone:
 * the `setShop*` writers have no gate of their own and write what they are
 * handed.
 */
describe("every settings mutation refuses the daily crew", () => {
  it("refuses a captain's timezone change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const form = new FormData();
    form.set("timezone", "Pacific/Auckland");
    const to = await redirectedTo(() => saveTimezoneAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not_authorized`);
    expect((await getShopById(db, shop.id))?.timezone).toBe(before?.timezone);
  });

  it("refuses a captain's address change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);

    const form = new FormData();
    for (const field of [
      "addressStreet",
      "addressLocality",
      "addressRegion",
      "addressPostalCode",
      "addressCountry",
    ]) {
      form.set(field, field === "addressCountry" ? "NZ" : "somewhere else");
    }
    const to = await redirectedTo(() => saveAddressAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not_authorized`);
    expect((await getShopById(db, shop.id))?.addressStreet).not.toBe("somewhere else");
  });

  it("refuses a captain's packing list and dock call, which had no gate at all before", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const packing = new FormData();
    packing.set("packingList", "towel\nsunscreen");
    expect(await redirectedTo(() => savePackingAction(packing))).toBe(
      `/shop/${shop.slug}/settings?notice=not_authorized`,
    );

    const dock = new FormData();
    dock.set("dockCallMinutes", "90");
    expect(await redirectedTo(() => saveDockCallAction(dock))).toBe(
      `/shop/${shop.slug}/settings?notice=not_authorized`,
    );

    const after = await getShopById(db, shop.id);
    expect(after?.packingList).toEqual(before?.packingList);
    expect(after?.dockCallMinutes).toBe(before?.dockCallMinutes);
  });

  it("still lets an owner through every one of them", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const dock = new FormData();
    dock.set("dockCallMinutes", "90");
    expect(await redirectedTo(() => saveDockCallAction(dock))).toBe(
      `/shop/${shop.slug}/settings?notice=dock_saved&saved=dockCall`,
    );
    expect((await getShopById(db, shop.id))?.dockCallMinutes).toBe(90);
  });
});
