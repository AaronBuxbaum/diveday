import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";
import { globalDiveSites, globalDiveSiteVersions } from "./schema";

/**
 * Publish DiveDay's dive-site catalog — the templates every shop's "Browse
 * templates" page offers.
 *
 * Its own scenario module rather than a block inside `seed-dive-sites.ts`
 * (ADR 20260803-seed-scenario-modules), because these rows are not the demo
 * shop's: `global_dive_sites` is DiveDay's own dataset, shared by every shop in
 * the database, and it is seeded once whether or not a demo shop exists. Wiring
 * it into the shop seed is how it came to hold exactly one site.
 *
 * **Idempotent by slug.** A shop's imported copy records
 * `source_template_id`/`source_template_version` and the library reads it back
 * to say "a newer version is published", so a re-seed must not mint a second
 * template for a slug a shop is already sourced from. An existing slug is left
 * alone entirely — publishing a *new* version is a deliberate act with a
 * version bump behind it, not something a re-run should do by accident.
 */
export async function seedDiveSiteCatalog(db: DbExecutor): Promise<Map<string, string>> {
  const existing = await db
    .select({ id: globalDiveSites.id, slug: globalDiveSites.slug })
    .from(globalDiveSites);
  const idBySlug = new Map(existing.map((row) => [row.slug, row.id]));

  for (const template of DIVE_SITE_TEMPLATES) {
    if (idBySlug.has(template.slug)) continue;
    const [published] = await db
      .insert(globalDiveSites)
      .values({ slug: template.slug, currentVersion: template.version })
      .returning();
    if (!published) throw new Error(`seed: could not publish dive-site template ${template.slug}`);
    idBySlug.set(template.slug, published.id);
    // Every version from 1 up to the current one, so a shop sourced from an
    // older version still resolves — and so the demo shop's own "template
    // update ready" badge has a real v1 to be behind (see `seedDiveSites`).
    await db.insert(globalDiveSiteVersions).values(
      Array.from({ length: template.version }, (_unused, index) => ({
        globalDiveSiteId: published.id,
        version: index + 1,
        briefing:
          index + 1 === template.version
            ? template.briefing
            : // Earlier versions are the same site with less written about it —
              // which is what an earlier version of a briefing actually is, and
              // what makes the "your edits are safe" badge demonstrable.
              {
                name: template.briefing.name,
                locationName: template.briefing.locationName,
                forecastLatitude: template.briefing.forecastLatitude,
                forecastLongitude: template.briefing.forecastLongitude,
                description: template.briefing.description,
                marineLife: template.briefing.marineLife,
              },
      })),
    );
  }
  return idBySlug;
}

/** The published template for one slug, for a seed that imports from the catalog. */
export async function publishedTemplateId(
  db: DbExecutor,
  slug: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: globalDiveSites.id })
    .from(globalDiveSites)
    .where(eq(globalDiveSites.slug, slug))
    .limit(1);
  return row?.id;
}
