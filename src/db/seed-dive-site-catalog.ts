import { eq } from "drizzle-orm";
import { DIVE_SITE_TEMPLATES, type DiveSiteTemplate } from "@/content/dive-site-templates";
import type { DbExecutor } from "./client";
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
 * template for a slug a shop is already sourced from.
 *
 * **A version bump publishes; nothing else does.** An existing slug whose
 * published version is already the template's is left alone, so a re-run
 * never rewrites a briefing by accident. A template whose `version` has gone
 * up gets that one new version row, holding its whole briefing, and the slug's
 * `current_version` moves to it — which is what puts "Template update ready"
 * in front of every shop sourced from it. Without this a corrected template
 * reached only a database that had never seen the slug.
 */
export async function seedDiveSiteCatalog(
  db: DbExecutor,
  templates: readonly DiveSiteTemplate[] = DIVE_SITE_TEMPLATES,
): Promise<Map<string, string>> {
  const existing = await db
    .select({
      id: globalDiveSites.id,
      slug: globalDiveSites.slug,
      currentVersion: globalDiveSites.currentVersion,
    })
    .from(globalDiveSites);
  const idBySlug = new Map(existing.map((row) => [row.slug, row.id]));
  const versionBySlug = new Map(existing.map((row) => [row.slug, row.currentVersion]));

  for (const template of templates) {
    const publishedId = idBySlug.get(template.slug);
    if (publishedId) {
      const published = versionBySlug.get(template.slug) ?? template.version;
      if (template.version > published) {
        await db.insert(globalDiveSiteVersions).values({
          globalDiveSiteId: publishedId,
          version: template.version,
          briefing: template.briefing,
        });
        await db
          .update(globalDiveSites)
          .set({ currentVersion: template.version })
          .where(eq(globalDiveSites.id, publishedId));
      }
      continue;
    }
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
