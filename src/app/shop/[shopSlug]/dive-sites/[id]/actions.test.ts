import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diveSites, shops } from "@/db/schema";
import { depthInUnit } from "@/lib/depth-units";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * The dive-site editor's doors, moved out of `page.tsx` closures. The page now binds the site id,
 * so the id arrives from the client: each door re-validates it and scopes every write to the
 * session's own shop.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
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
  deleteDiveSiteAction,
  pullDiveSiteTemplateAction,
  saveDiveSiteAction,
  undoDiveSiteTemplateAction,
} = await import("./actions");

async function signedIn() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  const [site] = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)))
    .limit(1);
  if (!site) throw new Error("seeded shop has no dive site");
  return { db, shop, siteId: site.id, back: shopPath(shop.slug, "dive-sites") };
}

describe("a malformed site id", () => {
  it("is not found at every door, before any read", async () => {
    await signedIn();
    const form = new FormData();
    await expect(deleteDiveSiteAction("abc")).rejects.toThrow("NOT_FOUND");
    await expect(undoDiveSiteTemplateAction("abc")).rejects.toThrow("NOT_FOUND");
    await expect(pullDiveSiteTemplateAction("abc", form)).rejects.toThrow("NOT_FOUND");
    await expect(saveDiveSiteAction("abc", {}, form)).rejects.toThrow("NOT_FOUND");
  });
});

describe("deleting a site", () => {
  it("soft-deletes it in the session's shop and says so", async () => {
    const { db, siteId, back } = await signedIn();
    expect(await redirectedTo(() => deleteDiveSiteAction(siteId))).toBe(noticeUrl(back, "deleted"));
    const [row] = await db.select().from(diveSites).where(eq(diveSites.id, siteId));
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("pulling a template update", () => {
  it("refuses a mode it does not know", async () => {
    const { siteId, back } = await signedIn();
    const form = new FormData();
    form.set("mode", "overwrite-everything");
    expect(await redirectedTo(() => pullDiveSiteTemplateAction(siteId, form))).toBe(
      noticeUrl(`${back}/${siteId}`, "template-update-unavailable"),
    );
  });
});

/**
 * **Only an owner or manager changes a site's admission fields** (Aaron,
 * 2026-11-03, issue #3706): the level, specialties, nitrox and max depth
 * decide who may buy a seat. The form shows them read-only to everyone else,
 * and a hidden control is not a gate, so these post straight to the action as
 * a captain and read the row back.
 */
describe("a dive site's admission fields", () => {
  async function asRole(email: string) {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const personId = await seededStaffPersonId(db, shop.id, email);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
    );
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)))
      .limit(1);
    if (!site) throw new Error("seeded shop has no dive site");
    // A site that asks for something on every admission field.
    await db
      .update(diveSites)
      .set({
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["wreck", "deep"],
        requiresNitrox: true,
        maxDepthMeters: 30,
      })
      .where(eq(diveSites.id, site.id));
    const [row] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
    const [shopRow] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!row || !shopRow) throw new Error("site or shop missing");
    return { db, siteId: site.id, row, depthUnit: shopRow.depthUnit };
  }

  /** The briefing as the edit form posts it back, untouched unless overridden. */
  function briefing(
    row: typeof diveSites.$inferSelect,
    depthUnit: "meters" | "feet",
    change: { level?: string; specialties?: string[]; nitrox?: boolean; maxDepth?: string } = {},
  ) {
    const form = new FormData();
    const fields: Record<string, string> = {
      name: row.name,
      description: row.description ?? "",
      locationName: row.locationName ?? "",
      forecastLatitude: row.forecastLatitude == null ? "" : String(row.forecastLatitude),
      forecastLongitude: row.forecastLongitude == null ? "" : String(row.forecastLongitude),
      marineLife: "",
      marineLifeDescription: row.marineLifeDescription ?? "",
      difficulty: "",
      depthRange: row.depthRange ?? "",
      minDepth: "",
      maxDepth:
        change.maxDepth ??
        (row.maxDepthMeters == null ? "" : String(depthInUnit(row.maxDepthMeters, depthUnit))),
      expectedBottomTime: "",
      currentNote: row.currentNote ?? "",
      divePlan: row.divePlan ?? "",
      fitTone: "",
      fitNote: "",
      conservationNote: "",
      fieldGuideTipsHeading: "",
      landmarks: "[]",
      creatures: "[]",
      minimumCertificationLevel: change.level ?? row.minimumCertificationLevel ?? "",
      expectedVersion: String(row.rowVersion),
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    for (const specialty of change.specialties ?? row.requiredSpecialties) {
      form.append("specialty", specialty);
    }
    if (change.nitrox ?? row.requiresNitrox) form.set("requiresNitrox", "on");
    return form;
  }

  async function admissionOf(db: typeof ctx.db, siteId: string) {
    const [row] = await db
      .select({
        level: diveSites.minimumCertificationLevel,
        specialties: diveSites.requiredSpecialties,
        nitrox: diveSites.requiresNitrox,
        maxDepth: diveSites.maxDepthMeters,
        description: diveSites.description,
      })
      .from(diveSites)
      .where(eq(diveSites.id, siteId));
    return row;
  }

  it("lets a captain save the rest of the briefing with the fields as shown", async () => {
    const { db, siteId, row, depthUnit } = await asRole(SEEDED_CAPTAIN_EMAIL);
    const form = briefing(row, depthUnit);
    form.set("description", "A wreck in 30 m of clear water.");
    await expect(saveDiveSiteAction(siteId, {}, form)).rejects.toThrow("REDIRECT:");
    expect(await admissionOf(db, siteId)).toMatchObject({
      level: "advanced_open_water",
      specialties: ["wreck", "deep"],
      nitrox: true,
      maxDepth: 30,
      description: "A wreck in 30 m of clear water.",
    });
  });

  it.each([
    ["drops the level", { level: "" }],
    ["lowers the level", { level: "open_water" }],
    ["drops a specialty", { specialties: ["wreck"] }],
    ["clears the specialties", { specialties: [] }],
    ["adds a specialty", { specialties: ["wreck", "deep", "night"] }],
    ["turns nitrox off", { nitrox: false }],
    ["clears the max depth", { maxDepth: "" }],
    ["deepens the max depth", { maxDepth: "200" }],
  ])("refuses a captain who %s, and leaves the site as it was", async (_label, change) => {
    const { db, siteId, row, depthUnit } = await asRole(SEEDED_CAPTAIN_EMAIL);
    const before = await admissionOf(db, siteId);
    const form = briefing(row, depthUnit, change);
    form.set("description", "Changed in the same post.");
    const state = await saveDiveSiteAction(siteId, {}, form);
    expect(state.errorCode).toBe("admissionManagersOnly");
    expect(await admissionOf(db, siteId)).toEqual(before);
  });

  // Security review of #3706: without the version, the write would put back
  // admission values read before a manager's tightening landed.
  it("refuses a captain's save that carries no version, and writes nothing", async () => {
    const { db, siteId, row, depthUnit } = await asRole(SEEDED_CAPTAIN_EMAIL);
    const before = await admissionOf(db, siteId);
    const form = briefing(row, depthUnit);
    form.delete("expectedVersion");
    form.set("description", "Posted without a version.");
    const state = await saveDiveSiteAction(siteId, {}, form);
    expect(state.errorCode).toBe("conflict");
    expect(await admissionOf(db, siteId)).toEqual(before);
  });

  it("tells a captain whose tab is out of date that someone saved first", async () => {
    const { db, siteId, row, depthUnit } = await asRole(SEEDED_CAPTAIN_EMAIL);
    // A manager tightened the site after this tab rendered.
    await db
      .update(diveSites)
      .set({ requiresNitrox: false, rowVersion: row.rowVersion + 1 })
      .where(eq(diveSites.id, siteId));
    const state = await saveDiveSiteAction(siteId, {}, briefing(row, depthUnit));
    expect(state.errorCode).toBe("conflict");
  });

  it("lets an owner change them", async () => {
    const { db, siteId, row, depthUnit } = await asRole(SEEDED_OWNER_EMAIL);
    const form = briefing(row, depthUnit, { level: "", specialties: [], nitrox: false });
    await expect(saveDiveSiteAction(siteId, {}, form)).rejects.toThrow("REDIRECT:");
    expect(await admissionOf(db, siteId)).toMatchObject({
      level: null,
      specialties: [],
      nitrox: false,
    });
  });

  it("refuses a captain the template pull and its undo, which rewrite them", async () => {
    const { siteId } = await asRole(SEEDED_CAPTAIN_EMAIL);
    const back = `${shopPath(ctx.shop.slug, "dive-sites")}/${siteId}`;
    const form = new FormData();
    form.set("mode", "replace-template-copy");
    expect(await redirectedTo(() => pullDiveSiteTemplateAction(siteId, form))).toBe(
      noticeUrl(back, "admission-managers-only"),
    );
    expect(await redirectedTo(() => undoDiveSiteTemplateAction(siteId))).toBe(
      noticeUrl(back, "admission-managers-only"),
    );
  });
});
