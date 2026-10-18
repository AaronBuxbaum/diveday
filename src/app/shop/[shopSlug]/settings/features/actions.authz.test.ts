import { describe, expect, it, vi } from "vitest";
import { getShopById } from "@/db/shops";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { FEATURE_ROWS } from "./feature-rows";

/**
 * **The Features page's one action, row by row** (issue #2814). Nine switches
 * that used to post to five actions from seven places now post here, each
 * naming the row it flips, so each row's gate is asserted by itself: a captain
 * is refused on every one of the nine, and the stored `shops` row is read
 * after the refusal rather than the notice alone (hiding a switch is not a
 * gate; a post carries whatever it likes).
 */

const ctx = fileScopedShopContext();

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
const { saveFeatureAction } = await import("./actions");

async function context() {
  const { db, shop } = ctx;
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

function form(row: string, on: Record<string, boolean> = {}) {
  const data = new FormData();
  data.set("row", row);
  for (const [name, enabled] of Object.entries(on)) if (enabled) data.set(name, "on");
  return data;
}

const FEATURES = "settings/features";

describe("the Features page's action", () => {
  it("covers the nine switches the issue names, each with a gate", () => {
    expect(FEATURE_ROWS.map((row) => row.id)).toEqual([
      "reviews",
      "tips",
      "dateRequests",
      "lastMinuteList",
      "publicYear",
      "padiChecks",
      "crewSchedule",
      "tax",
      "divingOptions",
    ]);
    // Tips and tax are payment settings; the crew schedule is the team's.
    const gate = (id: string) => FEATURE_ROWS.find((row) => row.id === id)?.gate;
    expect([gate("tips"), gate("tax"), gate("crewSchedule"), gate("reviews")]).toEqual([
      "payments",
      "payments",
      "team",
      "settings",
    ]);
  });

  it.each(FEATURE_ROWS.map((row) => row.id))("refuses a captain on %s", async (id) => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() => saveFeatureAction(form(id, { hasBoatDiving: true })));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });

  it("turns an optional feature off and back on, touching no other", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    expect(await redirectedTo(() => saveFeatureAction(form("reviews")))).toBe(
      `/shop/${shop.slug}/${FEATURES}?notice=feature-saved&saved=reviews`,
    );
    expect(await getShopById(db, shop.id)).toMatchObject({
      reviewsEnabled: false,
      dateRequestsEnabled: true,
      lastMinuteListEnabled: true,
      tipsEnabled: true,
      // The seeded demo runs the PADI checks; turning reviews off leaves them on.
      padiChecksEnabled: true,
    });

    await redirectedTo(() => saveFeatureAction(form("reviews", { enabled: true })));
    expect((await getShopById(db, shop.id))?.reviewsEnabled).toBe(true);
  });

  it("turns tips, Stripe Tax and the crew schedule on and off by their own columns", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    await redirectedTo(() => saveFeatureAction(form("tips")));
    expect((await getShopById(db, shop.id))?.tipsEnabled).toBe(false);

    await redirectedTo(() => saveFeatureAction(form("tax", { enabled: true })));
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(true);
    await redirectedTo(() => saveFeatureAction(form("tax")));
    expect((await getShopById(db, shop.id))?.taxEnabled).toBe(false);

    const before = await getShopById(db, shop.id);
    await redirectedTo(() => saveFeatureAction(form("crewSchedule", { enabled: true })));
    // Only the switch moves: the divemaster target is a value setting that stays.
    expect(await getShopById(db, shop.id)).toMatchObject({
      crewScheduleEnabled: true,
      diversPerDivemaster: before?.diversPerDivemaster,
    });
    await redirectedTo(() => saveFeatureAction(form("crewSchedule")));
    expect((await getShopById(db, shop.id))?.crewScheduleEnabled).toBe(false);
  });

  it("saves the three diving modes together, and refuses all three off", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    expect(
      await redirectedTo(() =>
        saveFeatureAction(form("divingOptions", { hasBoatDiving: true, hasPoolDiving: true })),
      ),
    ).toBe(`/shop/${shop.slug}/${FEATURES}?notice=feature-saved&saved=divingOptions`);
    expect(await getShopById(db, shop.id)).toMatchObject({
      hasBoatDiving: true,
      hasShoreDiving: false,
      hasPoolDiving: true,
    });

    const before = await getShopById(db, shop.id);
    expect(await redirectedTo(() => saveFeatureAction(form("divingOptions")))).toBe(
      `/shop/${shop.slug}/${FEATURES}?notice=diving-options-none&saved=divingOptions`,
    );
    expect(await getShopById(db, shop.id)).toEqual(before);
  });

  it("ignores a row it does not know, including a column name", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() => saveFeatureAction(form("crewScheduleEnabled")));

    expect(to).toBe(`/shop/${shop.slug}/${FEATURES}`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });
});
