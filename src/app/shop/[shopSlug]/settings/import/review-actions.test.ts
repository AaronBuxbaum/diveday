// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffSession } from "@/test/staff-session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/dive-site-photos", () => ({
  diveSitePhotoUrlsHeldByShop: vi.fn(async () => new Set()),
}));
vi.mock("@/features/accounts/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/features/records/import", async (original) => ({
  previewDiveSiteGuides: (await original<typeof import("@/features/records/import")>())
    .previewDiveSiteGuides,
  canPersonImportShopData: vi.fn(async () => true),
  previewDiveSiteImport: vi.fn(async () => []),
  previewGearImport: vi.fn(async () => []),
}));
vi.mock("@/features/gear/gear-import", async (original) => ({
  ...(await original<typeof import("@/features/gear/gear-import")>()),
  commitGearImport: vi.fn(async () => ({
    unitsCreated: 1,
    rowResults: [{ rowNumber: 2, issues: [] }],
  })),
}));
vi.mock("@/features/sites/dive-sites", async (original) => ({
  ...(await original<typeof import("@/features/sites/dive-sites")>()),
  commitDiveSiteImport: vi.fn(async () => ({
    updated: 0,
    created: 1,
    deleted: 0,
    skipped: [],
    guides: 1,
    creaturesSkipped: [],
  })),
}));

import { requireStaffSession } from "@/features/accounts/session";
import { commitGearImport } from "@/features/gear/gear-import";
import { canPersonImportShopData, previewDiveSiteImport } from "@/features/records/import";
import { commitDiveSiteImport } from "@/features/sites/dive-sites";
import { reviewExistingImportAction } from "./review-actions";

function form(kind: string, files: string[], mappings: string[][], types: string[]) {
  const data = new FormData();
  data.set("kind", kind);
  data.set("mappings", JSON.stringify(mappings));
  data.set("types", JSON.stringify(types));
  files.forEach((csv, index) => {
    data.append("file", new File([csv], `${index}.csv`, { type: "text/csv" }));
  });
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canPersonImportShopData).mockResolvedValue(true);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: "shop-from-session", personId: "staff-from-session", shopSlug: "reef" }),
  );
});
describe("existing import raw-byte authority", () => {
  it("rechecks live permission for both preview and commit", async () => {
    vi.mocked(canPersonImportShopData).mockResolvedValue(false);
    const data = form("gear", ["Tag\nA"], [["gear_label"]], ["gear"]);
    expect(await reviewExistingImportAction(data)).toEqual({ error: "not_authorized" });
    expect(await reviewExistingImportAction(data, true)).toEqual({ error: "not_authorized" });
    expect(commitGearImport).not.toHaveBeenCalled();
  });
  it.each([[["gear_label", "gear_label"]], [["gear_label", "not_a_field"]]])(
    "refuses tampered mappings before a write",
    async (mappings) => {
      expect(
        await reviewExistingImportAction(
          form("gear", ["Tag,Other\nA,B"], [mappings], ["gear"]),
          true,
        ),
      ).toEqual({ error: "invalid_mapping" });
      expect(commitGearImport).not.toHaveBeenCalled();
    },
  );
  it("reparses mapped raw gear and retains service errors rather than accepting client facts", async () => {
    const data = form(
      "gear",
      ["Tag,Date\nA,not-a-date"],
      [["gear_label", "serviced_on"]],
      ["gear"],
    );
    await reviewExistingImportAction(data, true);
    expect(commitGearImport).toHaveBeenCalledWith(
      expect.anything(),
      "shop-from-session",
      expect.objectContaining({
        rows: [expect.objectContaining({ label: "A", issues: ["invalid_service_date"] })],
      }),
      "staff-from-session",
    );
  });
  it("accepts renamed sites and guides together and passes both through existing validators", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const data = form(
      "sites",
      [`Source,Site\n${id},Reef`, `Parent,Species\n${id},nurse-shark`],
      [
        ["id", "name"],
        ["dive_site_id", "catalog_slug"],
      ],
      ["sites", "creatures"],
    );
    expect(await reviewExistingImportAction(data, true)).toMatchObject({
      completed: true,
      counts: { created: 1, guides: 1 },
    });
    expect(commitDiveSiteImport).toHaveBeenCalledWith(
      expect.anything(),
      "shop-from-session",
      expect.objectContaining({ rows: [expect.objectContaining({ sourceId: id, name: "Reef" })] }),
      "staff-from-session",
      expect.objectContaining({
        rows: [expect.objectContaining({ diveSiteId: id, catalogSlug: "nurse-shark" })],
      }),
    );
  });
  it("refuses two sites files before any partial restore", async () => {
    expect(
      await reviewExistingImportAction(
        form("sites", ["name\nOne", "name\nTwo"], [["name"], ["name"]], ["sites", "sites"]),
        true,
      ),
    ).toEqual({ error: "wrong_files" });
    expect(commitDiveSiteImport).not.toHaveBeenCalled();
  });
});

it("reports actual invalid gear rows as skipped, not processed", async () => {
  vi.mocked(commitGearImport).mockResolvedValueOnce({
    unitsCreated: 0,
    unitsMatched: 0,
    eventsAdded: 0,
    eventsSkipped: 0,
    assignmentsAdded: 0,
    assignmentsSkipped: 0,
    assignmentsUnmatched: 0,
    rowsSkipped: 1,
    rowResults: [{ rowNumber: 2, issues: ["invalid_service_date"] }],
  });
  const result = await reviewExistingImportAction(
    form("gear", ["Tag,Date\nA,not-a-date"], [["gear_label", "serviced_on"]], ["gear"]),
    true,
  );
  expect(result.rows?.[0][0].outcome).toBe("skip");
});

it("previews repeated and unplaced field-guide rows as skipped", async () => {
  vi.mocked(previewDiveSiteImport).mockResolvedValueOnce([
    { rowNumber: 2, outcome: "create", issues: [] },
  ]);
  const id = "11111111-1111-4111-8111-111111111111";
  const result = await reviewExistingImportAction(
    form(
      "sites",
      [
        `id,name\n${id},Reef`,
        `dive_site_id,catalog_slug\n${id},nurse-shark\n${id},nurse-shark\n22222222-2222-4222-8222-222222222222,nurse-shark`,
      ],
      [
        ["id", "name"],
        ["dive_site_id", "catalog_slug"],
      ],
      ["sites", "creatures"],
    ),
  );
  expect(result.rows?.[1].map((row) => row.outcome)).toEqual(["update", "skip", "skip"]);
  expect(result.rows?.[1][1].issues).toContain("duplicate_species");
  expect(result.rows?.[1][2].issues).toContain("site_not_restored");
});

it("previews the field-guide size limit in source position order", async () => {
  const { MARINE_LIFE_CATALOG } = await import("@/db/marine-life-catalog");
  const { MAX_SITE_CREATURES } = await import("@/lib/dive-site-field-guide");
  vi.mocked(previewDiveSiteImport).mockResolvedValueOnce([
    { rowNumber: 2, outcome: "create", issues: [] },
  ]);
  const id = "11111111-1111-4111-8111-111111111111";
  const creatures = MARINE_LIFE_CATALOG.slice(0, MAX_SITE_CREATURES + 1)
    .map((species, index) => `${id},${species.slug},${MAX_SITE_CREATURES - index}`)
    .join("\n");
  const result = await reviewExistingImportAction(
    form(
      "sites",
      [`id,name\n${id},Reef`, `dive_site_id,catalog_slug,position\n${creatures}`],
      [
        ["id", "name"],
        ["dive_site_id", "catalog_slug", "position"],
      ],
      ["sites", "creatures"],
    ),
  );
  expect(result.rows?.[1].filter((row) => row.outcome === "update")).toHaveLength(
    MAX_SITE_CREATURES,
  );
  expect(result.rows?.[1][0].issues).toEqual(["too_many_species"]);
});
