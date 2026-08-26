import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { mediaDeletionAttempts, processorErasureObligations } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { seededShopContext } from "@/test/db";
import {
  demoteOwnerToManager,
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
const { revalidatePath } = await import("next/cache");
const { requireStaffSession } = await import("@/lib/session");
const {
  dischargeProcessorErasureAction,
  retryMediaDeletionAction,
  retryProcessorErasureAction,
  saveAddressAction,
  saveDockDayRhythmAction,
  savePackingAction,
  saveTaxAction,
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

/**
 * A complete, valid rhythm submission. All six fields every time, because the
 * action parses them as one record — a partial post is exactly what it refuses.
 */
function dockDayForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const defaults: Record<string, string> = {
    dockCallMinutes: "90",
    gearSetupMinutes: "0",
    briefingMinutes: "15",
    boatRideMinutes: "20",
    bottomTimeMinutes: "45",
    surfaceIntervalMinutes: "60",
  };
  for (const [field, value] of Object.entries({ ...defaults, ...overrides })) {
    formData.set(field, value);
  }
  return formData;
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

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("lets an owner set all three", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ currency: "eur" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-saved&saved=units`);
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

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });

  it("refuses a depth unit that is not one of the two", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await unitsOf(db, shop.id);

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({ depthUnit: "fathoms" })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=units-invalid&saved=units`);
    expect(await unitsOf(db, shop.id)).toEqual(before);
  });
});

describe("saving the shop's Stripe Tax setting", () => {
  it("refuses a captain's tax change", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const form = new FormData();
    form.set("taxEnabled", "on");

    const to = await redirectedTo(() => saveTaxAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(false);
  });

  it("lets an owner enable and disable Stripe Tax", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const enabled = new FormData();
    enabled.set("taxEnabled", "on");

    expect(await redirectedTo(() => saveTaxAction(enabled))).toBe(
      `/shop/${shop.slug}/settings?notice=tax-saved&saved=tax`,
    );
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(true);

    expect(await redirectedTo(() => saveTaxAction(new FormData()))).toBe(
      `/shop/${shop.slug}/settings?notice=tax-saved&saved=tax`,
    );
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(false);
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

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
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

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect((await getShopById(db, shop.id))?.addressStreet).not.toBe("somewhere else");
  });

  it("refuses a captain's packing list and dock call, which had no gate at all before", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const packing = new FormData();
    packing.set("packingList", "towel\nsunscreen");
    expect(await redirectedTo(() => savePackingAction(packing))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    expect(await redirectedTo(() => saveDockDayRhythmAction(dockDayForm()))).toBe(
      `/shop/${shop.slug}/settings?notice=not-authorized`,
    );

    const after = await getShopById(db, shop.id);
    expect(after?.packingList).toEqual(before?.packingList);
    expect(after?.dockCallMinutes).toBe(before?.dockCallMinutes);
  });

  it("still lets an owner through every one of them", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    expect(await redirectedTo(() => saveDockDayRhythmAction(dockDayForm()))).toBe(
      `/shop/${shop.slug}/settings?notice=dock-saved&saved=dockCall`,
    );
    expect((await getShopById(db, shop.id))?.dockCallMinutes).toBe(90);
  });
});

/**
 * The two data-compliance queues moved here from the monthly report, and with
 * them three actions. These refuse by *returning*, not redirecting — the panel
 * that renders their forms is already hidden from anyone who would be refused,
 * so a refusal here is a hand-made post and gets no explanation, only nothing.
 * Which is exactly why each test reads the stored row afterwards: "no redirect
 * happened" would be equally true of a gate that silently let the write land.
 */
async function queueStuckDeletion(db: AppDb, shopId: string): Promise<string> {
  const [row] = await db
    .insert(mediaDeletionAttempts)
    .values({
      shopId,
      kind: "recap_photo",
      url: "https://blob.example/recap.jpg",
      status: "failed",
      lastError: "provider said no",
    })
    .returning({ id: mediaDeletionAttempts.id });
  return row.id;
}

async function oweErasure(db: AppDb, shopId: string, personId: string): Promise<string> {
  const [row] = await db
    .insert(processorErasureObligations)
    .values({
      shopId,
      // Provenance only — the row this points at is already anonymized.
      personId,
      target: "stripe_invoice_snapshot",
      externalId: "in_test",
      stripeAccountId: "acct_test",
      status: "owed",
    })
    .returning({ id: processorErasureObligations.id });
  return row.id;
}

function withId(field: string, id: string) {
  const form = new FormData();
  form.set(field, id);
  return form;
}

async function deletionStatus(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(eq(mediaDeletionAttempts.id, id));
  return row?.status;
}

async function erasureStatus(db: AppDb, shopId: string, id: string) {
  const [row] = await db
    .select()
    .from(processorErasureObligations)
    .where(
      and(eq(processorErasureObligations.id, id), eq(processorErasureObligations.shopId, shopId)),
    );
  return row?.status;
}

describe("the data-compliance queue actions", () => {
  it("refuses a captain's photo-deletion retry", async () => {
    // The gate that moved: it was `canPersonViewShopReports`, it is now this
    // page's `canPersonManageShopSettings`. Same `isOwnerOrManager` role set,
    // so a captain was refused before and must still be.
    const { db, shop, captain } = await context();
    const attemptId = await queueStuckDeletion(db, shop.id);
    signIn(shop, captain);

    await retryMediaDeletionAction(withId("attemptId", attemptId));

    // Untouched: a permitted retry resolves the row one way or the other.
    expect(await deletionStatus(db, attemptId)).toBe("failed");
  });

  it("refuses a manager's erasure retry and discharge — owner-only, and that did not move", async () => {
    // The gate that deliberately did *not* move: discharging attests a diver's
    // data is gone from Stripe (ADR 20260803-processor-erasure-obligations).
    // The seed's manager is also the owner, so the owner role comes off first.
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    await demoteOwnerToManager(db, owner);
    signIn(shop, owner);

    await retryProcessorErasureAction(withId("obligationId", obligationId));
    await dischargeProcessorErasureAction(withId("obligationId", obligationId));

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("owed");
  });

  it("lets an owner discharge an invoice snapshot — the only way that debt ever closes", async () => {
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    signIn(shop, owner);

    await dischargeProcessorErasureAction(withId("obligationId", obligationId));

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("discharged");
    // The revalidated path is derived from the session, never from an argument.
    // These three actions used to take a bound `shopSlug`, and a server action's
    // arguments are attacker-controlled — a hand-crafted POST could name any
    // shop and invalidate its cached settings page. The signature (FormData
    // only) is what makes that unreachable; this pins the slug it actually uses.
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/shop/${shop.slug}/settings`);
  });

  it("ignores a submission with no id rather than acting on a blank one", async () => {
    const { db, shop, owner } = await context();
    const obligationId = await oweErasure(db, shop.id, owner);
    signIn(shop, owner);

    await dischargeProcessorErasureAction(new FormData());

    expect(await erasureStatus(db, shop.id, obligationId)).toBe("owed");
  });
});
