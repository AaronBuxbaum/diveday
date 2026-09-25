import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Same mocking shape as ../embed/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, better-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const ImportContactsPage = (await import("./page")).default;

type HostProps = { className?: unknown; children?: ReactNode };

/** Every host `<li>` in the tree, in render order. */
function listItems(node: unknown, found: ReactElement<HostProps>[] = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) listItems(child, found);
    return found;
  }
  if (isValidElement<HostProps>(node)) {
    if (node.type === "li") found.push(node);
    listItems(node.props.children, found);
  }
  return found;
}

async function renderImport() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: SEEDED_OWNER_EMAIL,
      roles: ["owner", "manager"],
    },
  });
  return ImportContactsPage({ params: Promise.resolve({ shopSlug: "blue-mantis" }) });
}

describe("what comes across, and what stays behind", () => {
  /**
   * From `sm` up each row is three columns: what, the "stays behind" chip,
   * and the detail. The chip's cell used to render on every row, empty on the
   * ones that come across, to hold the detail's start edge — and on a phone,
   * where the row is one column, that empty cell took a 4px gap of its own,
   * so the pixel probe measured 8px between a row's name and its detail where
   * the chip rows sit 4px apart. The detail names its own column instead.
   */
  it("gives an empty chip cell no box, and pins the detail to its column", async () => {
    const rows = listItems(await renderImport()).filter(
      (item) =>
        typeof item.props.className === "string" &&
        item.props.className.includes("sm:grid-cols-[10rem_7rem_1fr]"),
    );
    expect(rows).toHaveLength(IMPORT_HONESTY_TABLE.length);
    expect(IMPORT_HONESTY_TABLE.some((row) => row.scope !== "stays-behind")).toBe(true);

    for (const [index, row] of rows.entries()) {
      const cells = Children.toArray(row.props.children).filter(isValidElement<HostProps>);
      for (const cell of cells) {
        expect(Children.toArray(cell.props.children).length, `row ${index}`).toBeGreaterThan(0);
      }
      const detail = cells.at(-1);
      expect(String(detail?.props.className)).toContain("sm:col-start-3");
      const staysBehind = IMPORT_HONESTY_TABLE[index]?.scope === "stays-behind";
      expect(cells, `row ${index}`).toHaveLength(staysBehind ? 3 : 2);
    }
  });
});
