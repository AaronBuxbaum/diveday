import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { REPLY_NOTES_MAX_LENGTH } from "@/lib/assists/inbox";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { FEATURE_ROWS, type FeatureRowGate, type FeatureRowId } from "./feature-rows";
import {
  planFeatureSave,
  REPLY_NOTES_DRAWN_FIELD,
  REPLY_NOTES_FIELD,
  ROWS_FIELD,
  switchField,
} from "./save-plan";

/**
 * **The Features page's one Save** (issue #2814; one form, Aaron 2026-10-23).
 * Every switch posts together, with the ids of the rows the page drew in
 * `rows`. The save writes those rows only, each behind its own gate, and the
 * stored `shops` row is read after every save rather than the notice alone
 * (hiding a switch is not a gate; a post carries whatever it likes). A row
 * the page did not draw is left exactly as it was, never read as "unchecked,
 * so off".
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
const { saveFeaturesAction } = await import("./actions");

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

const ALL_ROWS = FEATURE_ROWS.map((row) => row.id);
const DIVING = ["hasBoatDiving", "hasShoreDiving", "hasPoolDiving"] as const;

/**
 * The post the page makes: `rows` lists the rows drawn, and a ticked box sends
 * "on". `on` names the ticked rows (and diving modes); everything else drawn
 * posts as unticked, exactly as a browser sends it.
 */
function post(rows: readonly string[], on: readonly string[] = []) {
  const data = new FormData();
  for (const row of rows) data.append(ROWS_FIELD, row);
  for (const name of on) {
    data.set(
      (DIVING as readonly string[]).includes(name) ? name : switchField(name as FeatureRowId),
      "on",
    );
  }
  return data;
}

/** Every row drawn, every switch ticked: the page as a shop with all on posts it. */
const allOn = () => post(ALL_ROWS, [...ALL_ROWS.filter((id) => id !== "divingOptions"), ...DIVING]);

const FEATURES = "settings/features";

describe("the Features page's save", () => {
  it("covers every switch, each with a gate", () => {
    expect(ALL_ROWS).toEqual([
      "divingOptions",
      "hotelPickup",
      "publicConditions",
      "fieldGuide",
      "dateRequests",
      "lastMinuteList",
      "promoCodes",
      "divePackages",
      "tips",
      "tax",
      "checkoutRecovery",
      "buddyLinks",
      "selfRegistration",
      "waitlist",
      "pastDiverInvites",
      "partnerLinks",
      "reviews",
      "publicYear",
      "padiChecks",
      "sightings",
      "diverPhotos",
      "weekOutReminder",
      "helpRequests",
      "crewSchedule",
      "workOrders",
      "lostFound",
      "claudeSuggestions",
      "recapAutoApprove",
    ]);
    // Money switches are payment settings; the crew schedule is the team's.
    const gate = (id: string) => FEATURE_ROWS.find((row) => row.id === id)?.gate;
    expect(
      ["tips", "tax", "promoCodes", "divePackages", "crewSchedule", "reviews", "hotelPickup"].map(
        gate,
      ),
    ).toEqual(["payments", "payments", "payments", "payments", "team", "settings", "settings"]);
  });

  it("refuses a captain whole, writing nothing", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() => saveFeaturesAction(post(ALL_ROWS)));

    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });

  it("applies every switch at once, with one notice for the page", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    // Off: reviews, tips, the PADI checks and the crew schedule. On: Stripe
    // Tax, and boat and pool diving.
    const ticked = [
      "dateRequests",
      "lastMinuteList",
      "publicYear",
      "claudeSuggestions",
      "recapAutoApprove",
      "tax",
      "hasBoatDiving",
      "hasPoolDiving",
    ];
    expect(await redirectedTo(() => saveFeaturesAction(post(ALL_ROWS, ticked)))).toBe(
      `/shop/${shop.slug}/${FEATURES}?notice=feature-saved`,
    );
    expect(await getShopById(db, shop.id)).toMatchObject({
      reviewsEnabled: false,
      tipsEnabled: false,
      dateRequestsEnabled: true,
      lastMinuteListEnabled: true,
      publicYearEnabled: true,
      padiChecksEnabled: false,
      claudeSuggestionsEnabled: true,
      recapAssistAutoApprove: true,
      crewScheduleEnabled: false,
      taxEnabled: true,
      hasBoatDiving: true,
      hasShoreDiving: false,
      hasPoolDiving: true,
      // Only the switches move: the divemaster target is a value setting that stays.
      diversPerDivemaster: before?.diversPerDivemaster,
    });

    await redirectedTo(() => saveFeaturesAction(allOn()));
    expect(await getShopById(db, shop.id)).toMatchObject({
      reviewsEnabled: true,
      tipsEnabled: true,
      padiChecksEnabled: true,
      crewScheduleEnabled: true,
      hasShoreDiving: true,
    });
  });

  it("leaves a row the page did not draw as it was, never reading it as off", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    await redirectedTo(() => saveFeaturesAction(allOn()));

    // Tips, tax and the crew schedule absent from the page, nothing ticked.
    const drawn = ALL_ROWS.filter((id) => !["tips", "tax", "crewSchedule"].includes(id));
    await redirectedTo(() => saveFeaturesAction(post(drawn, ["hasBoatDiving"])));

    expect(await getShopById(db, shop.id)).toMatchObject({
      reviewsEnabled: false,
      tipsEnabled: true,
      taxEnabled: true,
      crewScheduleEnabled: true,
    });
  });

  it("refuses all three kinds of diving off and writes nothing, the other switches included", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    // Hand-built: every row named, every box unticked.
    expect(await redirectedTo(() => saveFeaturesAction(post(ALL_ROWS)))).toBe(
      `/shop/${shop.slug}/${FEATURES}?notice=diving-options-none`,
    );
    expect(await getShopById(db, shop.id)).toEqual(before);
  });

  it("ignores rows it does not know, including a column name", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() =>
      saveFeaturesAction(post(["crewScheduleEnabled", "taxEnabled"], ["crewScheduleEnabled"])),
    );

    expect(to).toBe(`/shop/${shop.slug}/${FEATURES}`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });
});

/**
 * Owner and manager pass all three gates today (`action-helpers.ts`), so no
 * seeded staffer can be the reader these guard against. The plan is the whole
 * decision of what a save writes, so it is asserted with the gate set such a
 * reader would have.
 */
describe("what a save writes for a manager without the payments gate", () => {
  const noPayments = new Set<FeatureRowGate>(["settings", "team"]);

  it("leaves tips and tax untouched when the page, drawn without them, is saved", () => {
    const drawn = ALL_ROWS.filter((id) => id !== "tips" && id !== "tax");
    const plan = planFeatureSave(post(drawn, ["reviews", "hasBoatDiving"]), noPayments);

    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.switches).not.toHaveProperty("tipsEnabled");
    expect(plan.switches).not.toHaveProperty("taxEnabled");
    expect(plan.switches).toMatchObject({ reviewsEnabled: true, crewScheduleEnabled: false });
  });

  it("drops tips and tax from a forged post that names them", () => {
    const plan = planFeatureSave(post(ALL_ROWS, ["tips", "tax", "hasBoatDiving"]), noPayments);

    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") return;
    expect(plan.switches).not.toHaveProperty("tipsEnabled");
    expect(plan.switches).not.toHaveProperty("taxEnabled");
  });

  it("writes nothing for a post naming only the rows it may not flip", () => {
    expect(planFeatureSave(post(["tips", "tax"], ["tips"]), noPayments)).toEqual({
      kind: "nothing",
    });
  });
});

describe("the notes for AI, saved with the switches", () => {
  async function notesOf(db: AppDb, shopId: string): Promise<string | null> {
    return (await getShopById(db, shopId))?.replyNotes ?? null;
  }

  /** The page with the notes box drawn: the marker and the box's text ride the one post. */
  function withNotes(data: FormData, notes: string): FormData {
    data.set(REPLY_NOTES_DRAWN_FIELD, "on");
    data.set(REPLY_NOTES_FIELD, notes);
    return data;
  }

  it("writes an owner's trimmed words with the switches, and an empty box clears them", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveFeaturesAction(withNotes(allOn(), "  Gate opens at 7:15.  ")),
    );
    expect(to).toBe(`/shop/${shop.slug}/${FEATURES}?notice=feature-saved`);
    expect(await getShopById(db, shop.id)).toMatchObject({
      replyNotes: "Gate opens at 7:15.",
      reviewsEnabled: true,
    });

    await redirectedTo(() => saveFeaturesAction(withNotes(allOn(), "   ")));
    expect(await notesOf(db, shop.id)).toBeNull();
  });

  it("caps the notes at their length", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    await redirectedTo(() =>
      saveFeaturesAction(withNotes(allOn(), "a".repeat(REPLY_NOTES_MAX_LENGTH + 50))),
    );
    expect(await notesOf(db, shop.id)).toHaveLength(REPLY_NOTES_MAX_LENGTH);
  });

  it("leaves the notes untouched when the page did not draw the box", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    await redirectedTo(() => saveFeaturesAction(withNotes(allOn(), "Gate opens at 7:15.")));

    // No marker: an absent box is not an empty one, even with a stray notes field.
    const data = allOn();
    data.set(REPLY_NOTES_FIELD, "");
    await redirectedTo(() => saveFeaturesAction(data));
    expect(await notesOf(db, shop.id)).toBe("Gate opens at 7:15.");
  });

  it("writes no notes when the diving refusal stops the save", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const before = await getShopById(db, shop.id);

    const to = await redirectedTo(() => saveFeaturesAction(withNotes(post(ALL_ROWS), "Refused")));
    expect(to).toBe(`/shop/${shop.slug}/${FEATURES}?notice=diving-options-none`);
    expect(await getShopById(db, shop.id)).toEqual(before);
  });

  it("refuses a captain, as it refuses every switch, and writes nothing", async () => {
    const { db, shop, captain } = await context();
    const before = await notesOf(db, shop.id);
    signIn(shop, captain);

    const to = await redirectedTo(() =>
      saveFeaturesAction(withNotes(post(ALL_ROWS), "A captain’s words")),
    );
    expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
    expect(await notesOf(db, shop.id)).toBe(before);
  });
});
