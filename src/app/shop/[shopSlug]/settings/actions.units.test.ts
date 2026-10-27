import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { importGlobalDiveSiteTemplate, listGlobalDiveSiteTemplates } from "@/db/dive-sites";
import { diveSites, shops } from "@/db/schema";
import { getShopById, setShopDepthUnit } from "@/db/shops";
import { briefingInUnit } from "@/lib/site-prose-units";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/dive-sites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/dive-sites")>();
  return {
    ...actual,
    convertImportedSiteProseToUnit: vi.fn(actual.convertImportedSiteProseToUnit),
  };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { saveJuniorBuddyPolicyAction, saveUnitsAction } = await import("./shop-actions");

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

describe("teen buddy policy", () => {
  it("starts off, accepts an explicit owner choice, and refuses a captain or an invalid value", async () => {
    const { db, shop, owner, captain } = await context();
    expect((await getShopById(db, shop.id))?.requireAdultBuddyForTeens).toBe(false);
    const form = new FormData();
    form.set("juniorBuddy", "required");
    signIn(shop, captain);
    expect(await redirectedTo(() => saveJuniorBuddyPolicyAction(form))).toContain("not-authorized");
    expect((await getShopById(db, shop.id))?.requireAdultBuddyForTeens).toBe(false);
    signIn(shop, owner);
    expect(await redirectedTo(() => saveJuniorBuddyPolicyAction(form))).toContain(
      "junior-buddy-saved",
    );
    expect((await getShopById(db, shop.id))?.requireAdultBuddyForTeens).toBe(true);
    form.set("juniorBuddy", "anything");
    expect(await redirectedTo(() => saveJuniorBuddyPolicyAction(form))).toContain(
      "junior-buddy-invalid",
    );
    expect((await getShopById(db, shop.id))?.requireAdultBuddyForTeens).toBe(true);
  });
});

/**
 * **A depth-unit switch carries the catalog's words with it** (issue #2683), as
 * the settings action sees it: one transaction, one tenant, one authorization.
 */
describe("saving the depth unit and the catalog prose", () => {
  async function importedSiteInMeters(shopId: string) {
    const { db } = ctx;
    const withMeasures = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.find(
      (row) =>
        JSON.stringify(briefingInUnit(row.version.briefing, "feet")) !==
        JSON.stringify(briefingInUnit(row.version.briefing, "meters")),
    );
    if (!withMeasures) throw new Error("seed: no catalog site names a measure");
    const site = await importGlobalDiveSiteTemplate(db, shopId, withMeasures.template.id);
    if (!site) throw new Error("expected a catalog copy");
    return site;
  }

  async function siteRow(id: string) {
    const [row] = await ctx.db.select().from(diveSites).where(eq(diveSites.id, id));
    if (!row) throw new Error("site missing");
    return row;
  }

  it("keeps the old unit when the prose conversion fails, so a retry still switches", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    await setShopDepthUnit(db, shop.id, "meters");
    try {
      const site = await importedSiteInMeters(shop.id);
      const { convertImportedSiteProseToUnit } = await import("@/db/dive-sites");
      vi.mocked(convertImportedSiteProseToUnit).mockRejectedValueOnce(new Error("boom"));

      await expect(saveUnitsAction(unitsForm({}))).rejects.toThrow("boom");

      expect((await unitsOf(db, shop.id)).depthUnit).toBe("meters");
      expect((await siteRow(site.id)).description).toBe(site.description);
      const retry = await redirectedTo(() => saveUnitsAction(unitsForm({})));
      expect(retry).toContain("notice=units-saved");
      expect((await unitsOf(db, shop.id)).depthUnit).toBe("feet");
    } finally {
      await setShopDepthUnit(db, shop.id, "feet");
    }
  });

  it("never touches another shop's catalog sites when this shop switches", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    const [other] = await db
      .insert(shops)
      .values({ name: "Unit Neighbour", slug: "unit-neighbour", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("insert failed");
    await setShopDepthUnit(db, shop.id, "meters");
    try {
      const theirs = await importedSiteInMeters(other.id);
      const before = await siteRow(theirs.id);

      await redirectedTo(() => saveUnitsAction(unitsForm({})));

      const after = await siteRow(theirs.id);
      expect(after.rowVersion).toBe(before.rowVersion);
      expect(after.description).toBe(before.description);
      expect(after.landmarks).toEqual(before.landmarks);
    } finally {
      await setShopDepthUnit(db, shop.id, "feet");
    }
  });

  it("leaves the prose alone when a captain's post is refused", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    await setShopDepthUnit(db, shop.id, "meters");
    try {
      const site = await importedSiteInMeters(shop.id);
      const before = await siteRow(site.id);

      const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

      expect(to).toBe(`/shop/${shop.slug}/settings?notice=not-authorized`);
      expect((await unitsOf(db, shop.id)).depthUnit).toBe("meters");
      const after = await siteRow(site.id);
      expect(after.rowVersion).toBe(before.rowVersion);
      expect(after.description).toBe(before.description);
    } finally {
      await setShopDepthUnit(db, shop.id, "feet");
    }
  });

  it("counts the edited catalog sites a depth-unit switch left alone", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);
    await setShopDepthUnit(db, shop.id, "meters");
    const withMeasures = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.find(
      (row) =>
        JSON.stringify(briefingInUnit(row.version.briefing, "feet")) !==
        JSON.stringify(briefingInUnit(row.version.briefing, "meters")),
    );
    if (!withMeasures) throw new Error("seed: no catalog site names a measure");
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, withMeasures.template.id);
    if (!imported) throw new Error("expected a catalog copy");
    await db
      .update(diveSites)
      .set({ description: `${imported.description ?? ""} Our own words.` })
      .where(eq(diveSites.id, imported.id));

    const to = await redirectedTo(() => saveUnitsAction(unitsForm({})));

    expect(to).toMatch(
      new RegExp(
        `^/shop/${shop.slug}/settings\\?notice=units-saved-sites-left&saved=units&count=[1-9]`,
      ),
    );
    expect(to).toContain("from=meters");
    expect(decodeURIComponent(to ?? "")).toContain(imported.name);
  });
});
