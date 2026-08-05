import { asc, eq } from "drizzle-orm";
import { describe, it } from "vitest";
import { diveSites, tripDives, trips } from "@/db/schema";
import { seededShopContext } from "@/test/db";

describe("seed audit", () => {
  it("lists every seeded trip's dives and sites", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await db
      .select({
        title: trips.title,
        plannedDives: trips.plannedDives,
        tripSite: trips.diveSiteId,
        diveNumber: tripDives.diveNumber,
        diveTitle: tripDives.title,
        siteName: diveSites.name,
      })
      .from(trips)
      .leftJoin(tripDives, eq(tripDives.tripId, trips.id))
      .leftJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
      .where(eq(trips.shopId, shop.id))
      .orderBy(asc(trips.title), asc(tripDives.diveNumber));

    const byTrip = new Map<string, { planned: number; dives: string[] }>();
    for (const row of rows) {
      const entry = byTrip.get(row.title) ?? { planned: row.plannedDives, dives: [] };
      entry.dives.push(
        `${row.diveNumber}:${row.siteName ?? "—"}${row.diveTitle ? ` (${row.diveTitle})` : ""}`,
      );
      byTrip.set(row.title, entry);
    }
    const lines: string[] = [];
    for (const [title, entry] of [...byTrip].sort()) {
      const distinct = new Set(
        entry.dives.map((d) => d.split(":")[1]?.split(" (")[0]).filter((n) => n && n !== "—"),
      );
      const blanks = entry.dives.filter((d) => d.includes(":—")).length;
      const flag =
        blanks > 0 && distinct.size > 0
          ? "  <<< MIXED"
          : blanks === entry.planned
            ? "  <<< NO SITES"
            : "";
      lines.push(
        `${title} | planned=${entry.planned} sites=${distinct.size} blank=${blanks}${flag}\n    ${entry.dives.join(" | ")}`,
      );
    }
    console.log(lines.join("\n"));
  });
});
