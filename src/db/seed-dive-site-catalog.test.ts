import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DiveSiteTemplate } from "@/content/dive-site-templates";
import { unseededTestDb } from "@/test/db";
import { globalDiveSites, globalDiveSiteVersions } from "./schema";
import { seedDiveSiteCatalog } from "./seed-dive-site-catalog";

function template(version: number, description: string): DiveSiteTemplate {
  return {
    slug: "test-reef",
    version,
    area: "florida-keys-upper",
    sources: ["https://example.org/a", "https://example.org/b"],
    briefing: { name: "Test Reef", description },
  };
}

async function published(db: Awaited<ReturnType<typeof unseededTestDb>>) {
  const [site] = await db
    .select()
    .from(globalDiveSites)
    .where(eq(globalDiveSites.slug, "test-reef"));
  const versions = site
    ? await db
        .select()
        .from(globalDiveSiteVersions)
        .where(eq(globalDiveSiteVersions.globalDiveSiteId, site.id))
    : [];
  return { site, versions: versions.sort((a, b) => a.version - b.version) };
}

describe("seedDiveSiteCatalog", () => {
  it("leaves a published slug alone when its version has not moved", async () => {
    const db = await unseededTestDb();
    await seedDiveSiteCatalog(db, [template(1, "First words.")]);
    await seedDiveSiteCatalog(db, [template(1, "Edited without a bump.")]);
    const { site, versions } = await published(db);
    expect(site?.currentVersion).toBe(1);
    expect(versions.map((row) => row.briefing.description)).toEqual(["First words."]);
  });

  it("publishes a version bump to a database that already holds the slug", async () => {
    const db = await unseededTestDb();
    await seedDiveSiteCatalog(db, [template(1, "First words.")]);
    await seedDiveSiteCatalog(db, [template(2, "Corrected words.")]);
    const { site, versions } = await published(db);
    expect(site?.currentVersion).toBe(2);
    expect(versions.map((row) => [row.version, row.briefing.description])).toEqual([
      [1, "First words."],
      [2, "Corrected words."],
    ]);
    // A third run is a no-op again.
    await seedDiveSiteCatalog(db, [template(2, "Corrected words.")]);
    expect((await published(db)).versions).toHaveLength(2);
  });
});
