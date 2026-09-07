// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { listRegionShops, listRegions } from "./regions";
import { shops } from "./schema";
import { REGION_NEIGHBOUR_SLUGS } from "./seed-region-neighbours";
import { setShopAddress, setShopSearchListing } from "./shops";
import { createTrip } from "./trips";

const ctx = fileScopedShopContext();
const DAY_MS = 24 * 60 * 60 * 1000;

async function shopIn(
  locality: string,
  options: { slug: string; isDemo?: boolean; departure?: boolean; listed?: boolean } = {
    slug: "probe",
  },
): Promise<string> {
  const [row] = await ctx.db
    .insert(shops)
    .values({
      name: `Shop ${options.slug}`,
      slug: options.slug,
      timezone: "America/New_York",
      isDemo: options.isDemo ?? false,
    })
    .returning({ id: shops.id });
  if (!row) throw new Error("shop did not insert");
  await setShopAddress(ctx.db, row.id, { addressLocality: locality, addressCountry: "US" });
  if (options.departure !== false) {
    const startsAt = new Date(nowDate().getTime() + 3 * DAY_MS);
    await createTrip(ctx.db, {
      shopId: row.id,
      title: "Probe",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
    });
  }
  if (options.listed === false) await setShopSearchListing(ctx.db, row.id, false);
  return row.id;
}

describe("setShopAddress derives the region", () => {
  it("writes the locality's slug, and clears it when the locality goes", async () => {
    const id = await shopIn("Islamorada", { slug: "isla-probe", departure: false });
    const [row] = await ctx.db.select().from(shops).where(eq(shops.id, id));
    expect(row?.regionSlug).toBe("islamorada");

    const cleared = await setShopAddress(ctx.db, id, { addressLocality: "", addressCountry: "US" });
    expect(cleared?.regionSlug).toBeNull();
  });
});

describe("listRegions (in-memory PGlite)", () => {
  it("counts the seeded Key Largo neighbours and never the demo beside them", async () => {
    const regions = await listRegions(ctx.db);
    const keyLargo = regions.find((region) => region.slug === "key-largo");
    expect(keyLargo).toEqual({ slug: "key-largo", name: "Key Largo", shopCount: 2 });
  });

  it("adds a region the moment a listed shop with a departure lands in it", async () => {
    await shopIn("Islamorada", { slug: "isla-listed" });
    const regions = await listRegions(ctx.db);
    expect(regions.find((region) => region.slug === "islamorada")).toEqual({
      slug: "islamorada",
      name: "Islamorada",
      shopCount: 1,
    });
    // Most shops first, so Key Largo's two lead Islamorada's one.
    expect(regions.map((region) => region.slug).indexOf("key-largo")).toBeLessThan(
      regions.map((region) => region.slug).indexOf("islamorada"),
    );
  });

  it("leaves out a shop with nothing scheduled, one that opted out, and a demo", async () => {
    await shopIn("Marathon", { slug: "marathon-quiet", departure: false });
    await shopIn("Tavernier", { slug: "tavernier-shy", listed: false });
    await shopIn("Big Pine Key", { slug: "big-pine-demo", isDemo: true });
    const slugs = (await listRegions(ctx.db)).map((region) => region.slug);
    expect(slugs).not.toContain("marathon");
    expect(slugs).not.toContain("tavernier");
    expect(slugs).not.toContain("big-pine-key");
  });
});

describe("listRegionShops (in-memory PGlite)", () => {
  it("returns the listed shops in a region by name, and nothing else", async () => {
    const rows = await listRegionShops(ctx.db, "key-largo");
    expect(rows.map((shop) => shop.slug)).toEqual([...REGION_NEIGHBOUR_SLUGS].sort());
    expect(rows.map((shop) => shop.slug)).not.toContain("blue-mantis");
  });

  it("drops a shop the moment it opts out of search", async () => {
    const id = await shopIn("Islamorada", { slug: "isla-leaving" });
    expect((await listRegionShops(ctx.db, "islamorada")).map((s) => s.id)).toContain(id);
    await setShopSearchListing(ctx.db, id, false);
    expect((await listRegionShops(ctx.db, "islamorada")).map((s) => s.id)).not.toContain(id);
  });

  it("is empty for a region nobody is in", async () => {
    expect(await listRegionShops(ctx.db, "atlantis")).toEqual([]);
  });
});
