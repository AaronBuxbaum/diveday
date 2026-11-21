import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { diveSites, mediaDeletionAttempts, shops } from "@/db/schema";
import { depthInUnit } from "@/lib/depth-units";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

const ctx = fileScopedShopContext();

vi.stubEnv("MEDIA_PUBLIC_URL_BASE", "https://blob.example");

/**
 * A briefing's photos are stored before the row is written, so a save the row
 * then refuses (the name is taken, the site is gone) must hand every object it
 * just stored to the deletion ledger: the form comes back empty of files and the
 * staffer picks them again, which would otherwise store each photo twice.
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
vi.mock("../../../../../features/accounts/session", () => ({ requireStaffSession: vi.fn() }));
const stored = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    storeDiveSiteImage: vi.fn(async () => ({
      status: "stored",
      url: `https://blob.example/site-${++stored.n}.jpg`,
    })),
  };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../features/accounts/session");
const { saveDiveSiteAction } = await import("./actions");

async function twoSites() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  const sites = await db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shop.id), isNull(diveSites.deletedAt)))
    .limit(2);
  const [shopRow] = await db.select().from(shops).where(eq(shops.id, shop.id));
  const [first, second] = sites;
  if (!first || !second || !shopRow) throw new Error("seeded shop needs two dive sites");
  return { db, first, second, depthUnit: shopRow.depthUnit };
}

function briefing(
  row: typeof diveSites.$inferSelect,
  depthUnit: "meters" | "feet",
  name: string,
): FormData {
  const form = new FormData();
  const fields: Record<string, string> = {
    name,
    description: row.description ?? "",
    locationName: row.locationName ?? "",
    forecastLatitude: row.forecastLatitude == null ? "" : String(row.forecastLatitude),
    forecastLongitude: row.forecastLongitude == null ? "" : String(row.forecastLongitude),
    marineLife: "",
    marineLifeDescription: row.marineLifeDescription ?? "",
    difficulty: "",
    depthRange: row.depthRange ?? "",
    minDepth: "",
    maxDepth: row.maxDepthMeters == null ? "" : String(depthInUnit(row.maxDepthMeters, depthUnit)),
    expectedBottomTime: "",
    currentNote: row.currentNote ?? "",
    divePlan: row.divePlan ?? "",
    fitTone: "",
    fitNote: "",
    conservationNote: "",
    fieldGuideTipsHeading: "",
    landmarks: "[]",
    creatures: "[]",
    minimumCertificationLevel: row.minimumCertificationLevel ?? "",
    expectedVersion: String(row.rowVersion),
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const specialty of row.requiredSpecialties) form.append("specialty", specialty);
  if (row.requiresNitrox) form.set("requiresNitrox", "on");
  return form;
}

describe("a briefing save the row refuses", () => {
  it("queues the photos it just stored for deletion", async () => {
    const { db, first, second, depthUnit } = await twoSites();
    const form = briefing(first, depthUnit, second.name);
    form.set(
      "satelliteImageFile",
      new File([new Uint8Array([1, 2, 3])], "map.jpg", { type: "image/jpeg" }),
    );
    form.append(
      "siteImageFiles",
      new File([new Uint8Array([4, 5, 6])], "a.jpg", { type: "image/jpeg" }),
    );

    const state = await saveDiveSiteAction(first.id, {}, form);

    expect(state.errorCode).toBe("nameTaken");
    const queued = await db
      .select({ url: mediaDeletionAttempts.url, kind: mediaDeletionAttempts.kind })
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.shopId, ctx.shop.id));
    expect(queued.filter((row) => row.kind === "dive_site_photo")).toHaveLength(2);
    // The site itself kept its stored photos.
    const [after] = await db.select().from(diveSites).where(eq(diveSites.id, first.id));
    expect(after?.satelliteImageUrl).toBe(first.satelliteImageUrl);
  });
});
