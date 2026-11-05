import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DIVE_SITE_IMPORT_COLUMNS, prepareDiveSiteImport } from "@/lib/dive-site-import";
import { buildCsv } from "@/lib/export";
import { unseededTestDb } from "@/test/db";
import { commitDiveSiteImport } from "./dive-site-import";
import { diveSites, people, shops } from "./schema";

async function bareContext() {
  const db = await unseededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bare Reef Divers", slug: "import-closure", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [staff] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Importer", email: "import-closure@example.com" })
    .returning();
  if (!staff) throw new Error("person insert failed");
  return { db, shop, staffId: staff.id };
}

describe("the dive-site importer's closure window", () => {
  /** A site closed for a while comes back closed, with the shop's reason; a bad window skips its row. */
  it("restores a site's closure window", async () => {
    const { db, shop, staffId } = await bareContext();
    const row = (name: string, from: string, until: string) =>
      DIVE_SITE_IMPORT_COLUMNS.map((column) =>
        column === "name"
          ? name
          : column === "closed_from"
            ? from
            : column === "closed_until"
              ? until
              : column === "closure_reason"
                ? "Mooring buoys out"
                : null,
      );
    const csv = buildCsv(
      [...DIVE_SITE_IMPORT_COLUMNS],
      [
        row("Twin Caves", "2026-11-10", "2026-11-20"),
        row("Reverse Reef", "2026-11-20", "2026-11-10"),
      ],
    );
    const summary = await commitDiveSiteImport(db, shop.id, prepareDiveSiteImport(csv), staffId);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toEqual([{ rowNumber: 3, issues: ["invalid_closure"] }]);
    const [caves] = await db.select().from(diveSites).where(eq(diveSites.shopId, shop.id));
    expect([caves?.closedFrom, caves?.closedUntil, caves?.closureReason]).toEqual([
      "2026-11-10",
      "2026-11-20",
      "Mooring buoys out",
    ]);
  });
});
