import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diveSites, shops } from "@/db/schema";
import { shopPath } from "@/lib/staff-notices";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * The new-site form's action. It runs against the seeded shop so the name
 * rule, which only the database can check, is the real one.
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
const { createDiveSiteAction } = await import("./actions");

async function signedIn() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { db, shop, personId, back: shopPath(shop.slug, "dive-sites") };
}

/** A minimal valid submission, the same shape `src/lib/dive-sites.test.ts` uses. */
function siteForm(overrides: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
    name: "Turtle Garden",
    description: "",
    locationName: "",
    forecastLatitude: "25.123",
    forecastLongitude: "-80.321",
    marineLife: "",
    marineLifeDescription: "",
    difficulty: "",
    depthRange: "",
    minDepth: "",
    maxDepth: "",
    expectedBottomTime: "",
    currentNote: "",
    divePlan: "",
    fitTone: "",
    fitNote: "",
    conservationNote: "",
    fieldGuideTipsHeading: "",
    landmarks: "[]",
    creatures: "[]",
    minimumCertificationLevel: "",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("createDiveSiteAction", () => {
  it("creates the site in the session's shop, with its author, and opens it", async () => {
    const { db, shop, personId, back } = await signedIn();
    const name = `Turtle Garden ${crypto.randomUUID().slice(0, 8)}`;

    const to = await redirectedTo(() =>
      createDiveSiteAction({}, siteForm({ name, planningNote: "Slack tide only" })),
    );

    const [site] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, name)));
    expect(site).toBeDefined();
    expect(to).toBe(`${back}/${site?.id}`);
    expect(site?.forecastLatitude).toBeCloseTo(25.123);
    expect(site?.planningNoteByPersonId).toBe(personId);
  });

  it("stores the depth range as two numbers in metres, whatever unit the shop typed", async () => {
    const { db, shop } = await signedIn();
    const name = `Depth ${crypto.randomUUID().slice(0, 8)}`;
    await db.update(shops).set({ depthUnit: "feet" }).where(eq(shops.id, shop.id));

    await redirectedTo(() =>
      createDiveSiteAction({}, siteForm({ name, minDepth: "20", maxDepth: "60" })),
    );

    const [site] = await db
      .select()
      .from(diveSites)
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.name, name)));
    expect(site?.depthMinMeters).toBeCloseTo(6.096, 3);
    expect(site?.maxDepthMeters).toBeCloseTo(18.288, 3);
    // The shallow end alone is refused in place, nothing written.
    const refused = await createDiveSiteAction({}, siteForm({ name: `${name} b`, minDepth: "20" }));
    expect(refused.errorCode).toBe("depthRangeInvalid");
  });

  it("answers a form that does not parse in place, carrying the submission back", async () => {
    await signedIn();
    const state = await createDiveSiteAction(
      {},
      siteForm({ name: "Half a pair", forecastLongitude: "" }),
    );
    expect(state.errorCode).toBe("coordinatesIncomplete");
    expect(state.values?.name).toEqual(["Half a pair"]);
  });

  it("refuses a specialty the schema does not know", async () => {
    await signedIn();
    const form = siteForm({ name: `Odd ${crypto.randomUUID().slice(0, 8)}` });
    form.append("specialty", "space-walk");
    expect((await createDiveSiteAction({}, form)).errorCode).toBe("invalid");
  });

  it("refuses a name the shop's library already holds", async () => {
    const { db, shop } = await signedIn();
    const [existing] = await db
      .select({ name: diveSites.name })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .limit(1);
    if (!existing) throw new Error("seeded shop has no dive site");

    const state = await createDiveSiteAction({}, siteForm({ name: existing.name }));
    expect(state.errorCode).toBe("nameTaken");
    expect(state.values?.name).toEqual([existing.name]);
  });
});
