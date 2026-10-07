// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **An import with nothing in it is refused before anything is read or
 * written.** The three importers on Settings' import page each read one field
 * off their form — a file for gear and dive sites, pasted text for contacts —
 * and an empty one answers with the page's own refusal: `import-empty` back on
 * the tab, or `csv_required` in the wizard's state.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/import")>();
  return {
    ...actual,
    canPersonImportShopData: vi.fn(async () => true),
    commitContactImport: vi.fn(),
  };
});
vi.mock("@/db/gear-import", () => ({ commitGearImport: vi.fn() }));
vi.mock("@/db/dive-site-import", () => ({ commitDiveSiteImport: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { requireStaffSession } = await import("@/lib/session");
const { commitContactImport } = await import("@/db/import");
const { commitGearImport } = await import("@/db/gear-import");
const { commitDiveSiteImport } = await import("@/db/dive-site-import");
const { importContactsAction } = await import("./actions");
const { importGearServiceHistoryAction } = await import("./gear-actions");
const { restoreDiveSitesAction } = await import("./dive-site-actions");

const SHOP_SLUG = "reef-life";
const page = shopPath(SHOP_SLUG, "settings", "import");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({
      shopId: "11111111-1111-4111-8111-111111111111",
      shopSlug: SHOP_SLUG,
      personId: "22222222-2222-4222-8222-222222222222",
    }),
  );
});

function withFile(file: File | null): FormData {
  const data = new FormData();
  if (file) data.set("file", file);
  return data;
}

describe("the file importers", () => {
  it.each([
    ["gear", importGearServiceHistoryAction, commitGearImport],
    ["dive-sites", restoreDiveSitesAction, commitDiveSiteImport],
  ] as const)(
    "refuse %s with no file, or an empty one, back on its tab",
    async (tab, action, commit) => {
      for (const data of [withFile(null), withFile(new File([], "empty.csv"))]) {
        expect(await redirectedTo(() => action(data))).toBe(
          noticeUrl(`${page}?what=${tab}`, "import-empty"),
        );
      }
      expect(commit).not.toHaveBeenCalled();
    },
  );
});

describe("the contacts importer", () => {
  it("asks for a CSV when none was pasted", async () => {
    for (const csv of [null, "   "]) {
      const data = new FormData();
      if (csv !== null) data.set("csv", csv);
      expect(await importContactsAction({ status: "idle" }, data)).toEqual({
        status: "error",
        code: "csv_required",
      });
    }
    expect(commitContactImport).not.toHaveBeenCalled();
  });
});
