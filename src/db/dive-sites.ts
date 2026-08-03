import { and, asc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import {
  type DiveSpecialty,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  globalDiveSites,
  globalDiveSiteVersions,
  tripDives,
  trips,
} from "./schema";

export type DiveSiteInput = {
  shopId: string;
  name: string;
  description?: string;
  locationName?: string;
  forecastLatitude?: number | null;
  forecastLongitude?: number | null;
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls?: string[];
  marineLife?: string;
  marineLifeDescription?: string;
  difficulty?: string;
  depthRange?: string;
  /** Canonical metres, whatever unit the shop typed it in (src/lib/depth-units.ts). */
  maxDepthMeters?: number | null;
  currentNote?: string;
  divePlan?: string;
  landmarks?: string[];
  /** The site's inherent cert gate; composed into every trip that visits it. */
  minimumCertificationLevel?: CertificationLevel | null;
  requiredSpecialties?: DiveSpecialty[];
  requiresNitrox?: boolean;
};

export async function listDiveSites(db: AppDb, shopId: string) {
  return db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .orderBy(asc(diveSites.name));
}

export async function getDiveSite(db: AppDb, shopId: string, siteId: string) {
  const [site] = await db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .limit(1);
  return site ?? null;
}

export async function createDiveSite(db: AppDb, input: DiveSiteInput) {
  const [site] = await db
    .insert(diveSites)
    .values({
      ...input,
      description: input.description || null,
      locationName: input.locationName || null,
      forecastLatitude: input.forecastLatitude ?? null,
      forecastLongitude: input.forecastLongitude ?? null,
      satelliteImageUrl: input.satelliteImageUrl || null,
      routeImageUrl: input.routeImageUrl || null,
      imageUrls: input.imageUrls ?? [],
      marineLife: input.marineLife || null,
      marineLifeDescription: input.marineLifeDescription || null,
      difficulty: input.difficulty || null,
      depthRange: input.depthRange || null,
      currentNote: input.currentNote || null,
      divePlan: input.divePlan || null,
      landmarks: input.landmarks ?? [],
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiredSpecialties: input.requiredSpecialties ?? [],
      requiresNitrox: input.requiresNitrox ?? false,
    })
    .returning();
  if (!site) throw new Error("createDiveSite: insert returned no row");
  return site;
}

export async function updateDiveSite(
  db: AppDb,
  shopId: string,
  siteId: string,
  input: DiveSiteInput,
) {
  const [site] = await db
    .update(diveSites)
    .set({
      name: input.name,
      description: input.description || null,
      locationName: input.locationName || null,
      forecastLatitude: input.forecastLatitude ?? null,
      forecastLongitude: input.forecastLongitude ?? null,
      satelliteImageUrl: input.satelliteImageUrl || null,
      routeImageUrl: input.routeImageUrl || null,
      imageUrls: input.imageUrls ?? [],
      marineLife: input.marineLife || null,
      marineLifeDescription: input.marineLifeDescription || null,
      difficulty: input.difficulty || null,
      depthRange: input.depthRange || null,
      // `?? null` rather than `|| null`: 0 is not a real site depth, but the
      // distinction still matters — an omitted field clears the column, which
      // is how a shop takes a depth back off a site.
      maxDepthMeters: input.maxDepthMeters ?? null,
      currentNote: input.currentNote || null,
      divePlan: input.divePlan || null,
      landmarks: input.landmarks ?? [],
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiredSpecialties: input.requiredSpecialties ?? [],
      requiresNitrox: input.requiresNitrox ?? false,
    })
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .returning();
  return site ?? null;
}

/** Keep historical trip briefings intact while removing a site from new-trip pickers. */
export async function deleteDiveSite(db: AppDb, shopId: string, siteId: string) {
  const [site] = await db
    .update(diveSites)
    .set({ deletedAt: nowDate() })
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .returning({ id: diveSites.id });
  return Boolean(site);
}

/** Copying makes an independent briefing; edits never surprise another charter. */
export async function copyDiveSite(db: AppDb, shopId: string, siteId: string, name: string) {
  const source = await getDiveSite(db, shopId, siteId);
  if (!source) return null;
  return createDiveSite(db, {
    shopId,
    name,
    description: source.description ?? undefined,
    locationName: source.locationName ?? undefined,
    forecastLatitude: source.forecastLatitude,
    forecastLongitude: source.forecastLongitude,
    satelliteImageUrl: source.satelliteImageUrl ?? undefined,
    routeImageUrl: source.routeImageUrl ?? undefined,
    imageUrls: source.imageUrls,
    marineLife: source.marineLife ?? undefined,
    marineLifeDescription: source.marineLifeDescription ?? undefined,
    difficulty: source.difficulty ?? undefined,
    depthRange: source.depthRange ?? undefined,
    maxDepthMeters: source.maxDepthMeters,
    currentNote: source.currentNote ?? undefined,
    divePlan: source.divePlan ?? undefined,
    landmarks: source.landmarks,
    minimumCertificationLevel: source.minimumCertificationLevel,
    requiredSpecialties: source.requiredSpecialties,
    requiresNitrox: source.requiresNitrox,
  });
}

export async function listDiveSiteCreatures(db: AppDb, shopId: string, siteId: string) {
  return db
    .select()
    .from(diveSiteCreatures)
    .where(and(eq(diveSiteCreatures.shopId, shopId), eq(diveSiteCreatures.diveSiteId, siteId)));
}

export async function listPublishedDiveSiteMoments(db: AppDb, shopId: string, siteId: string) {
  return db
    .select()
    .from(diveSiteMoments)
    .where(
      and(
        eq(diveSiteMoments.shopId, shopId),
        eq(diveSiteMoments.diveSiteId, siteId),
        eq(diveSiteMoments.isPublished, true),
      ),
    )
    .orderBy(asc(diveSiteMoments.createdAt));
}

/**
 * Creatures and published moments for several sites at once, grouped by site.
 *
 * The public trip page renders a briefing per dive, and asking per site cost it
 * two round trips per dive — six on a three-tank day, on the page a diver hits
 * straight from a marketing link. Two queries cover any number of dives.
 */
export async function listDiveSiteBriefingExtras(
  db: AppDb,
  shopId: string,
  siteIds: string[],
): Promise<{
  creatures: Map<string, Awaited<ReturnType<typeof listDiveSiteCreatures>>>;
  moments: Map<string, Awaited<ReturnType<typeof listPublishedDiveSiteMoments>>>;
}> {
  const unique = [...new Set(siteIds)];
  if (unique.length === 0) return { creatures: new Map(), moments: new Map() };

  const [creatureRows, momentRows] = await Promise.all([
    db
      .select()
      .from(diveSiteCreatures)
      .where(
        and(eq(diveSiteCreatures.shopId, shopId), inArray(diveSiteCreatures.diveSiteId, unique)),
      ),
    db
      .select()
      .from(diveSiteMoments)
      .where(
        and(
          eq(diveSiteMoments.shopId, shopId),
          inArray(diveSiteMoments.diveSiteId, unique),
          eq(diveSiteMoments.isPublished, true),
        ),
      )
      .orderBy(asc(diveSiteMoments.createdAt)),
  ]);

  const creatures = new Map<string, typeof creatureRows>();
  for (const row of creatureRows) {
    creatures.set(row.diveSiteId, [...(creatures.get(row.diveSiteId) ?? []), row]);
  }
  const moments = new Map<string, typeof momentRows>();
  for (const row of momentRows) {
    moments.set(row.diveSiteId, [...(moments.get(row.diveSiteId) ?? []), row]);
  }
  return { creatures, moments };
}

export async function listGlobalDiveSiteTemplates(db: AppDb) {
  const rows = await db
    .select({ template: globalDiveSites, version: globalDiveSiteVersions })
    .from(globalDiveSites)
    .innerJoin(
      globalDiveSiteVersions,
      and(
        eq(globalDiveSiteVersions.globalDiveSiteId, globalDiveSites.id),
        eq(globalDiveSiteVersions.version, globalDiveSites.currentVersion),
      ),
    )
    .orderBy(asc(globalDiveSites.slug));
  return rows;
}

export type UpcomingSiteTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
};

/**
 * Upcoming departures that dive this site — the reverse lookup from a site to
 * the trips that use it, joined through `trip_dives` (a trip can visit more
 * than one site across its dives, so this is not the same as `trips.diveSiteId`).
 */
export async function listUpcomingTripsForSite(
  db: AppDb,
  shopId: string,
  diveSiteId: string,
  now: Date = nowDate(),
): Promise<UpcomingSiteTrip[]> {
  const rows = await db
    .selectDistinct({ tripId: trips.id, title: trips.title, startsAt: trips.startsAt })
    .from(tripDives)
    .innerJoin(trips, eq(trips.id, tripDives.tripId))
    .where(
      and(
        eq(tripDives.diveSiteId, diveSiteId),
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows;
}

export async function importGlobalDiveSiteTemplate(db: AppDb, shopId: string, templateId: string) {
  const [row] = await db
    .select({ template: globalDiveSites, version: globalDiveSiteVersions })
    .from(globalDiveSites)
    .innerJoin(
      globalDiveSiteVersions,
      and(
        eq(globalDiveSiteVersions.globalDiveSiteId, globalDiveSites.id),
        eq(globalDiveSiteVersions.version, globalDiveSites.currentVersion),
      ),
    )
    .where(eq(globalDiveSites.id, templateId))
    .limit(1);
  if (!row) return null;
  const briefing = row.version.briefing;
  const [site] = await db
    .insert(diveSites)
    .values({
      shopId,
      ...briefing,
      name: await availableSiteName(db, shopId, briefing.name),
      sourceTemplateId: row.template.id,
      sourceTemplateVersion: row.version.version,
      imageUrls: briefing.imageUrls ?? [],
      landmarks: briefing.landmarks ?? [],
    })
    .returning();
  return site ?? null;
}

/**
 * `name`, or the first free `name 2`, `name 3`, … for this shop.
 *
 * `dive_sites_shop_name_unique` is a hard (shop_id, name) constraint, and an
 * import is the one write that cannot choose its own name — it takes the
 * template's. A shop that already holds a site by that name is the *normal*
 * case, not an edge one: importing a template is exactly how most shops got
 * their copy, and the catalog offers the same card again afterwards (the seeded
 * demo shop ships in precisely that state). Without this the insert raised an
 * unhandled 23505 and the import crashed the page into its error boundary —
 * found the moment e2e/dive-sites.spec.ts first pressed the button.
 *
 * Disambiguating rather than refusing keeps the promise the catalog page makes:
 * importing makes an *independent* briefing and never overwrites the shop's own
 * edits. Same shape as the "Copy and tailor" action's `{name} copy 2` loop.
 * Archived sites count — the unique index does not exclude them.
 */
async function availableSiteName(db: AppDb, shopId: string, name: string): Promise<string> {
  const taken = new Set(
    (
      await db.select({ name: diveSites.name }).from(diveSites).where(eq(diveSites.shopId, shopId))
    ).map((row) => row.name),
  );
  let candidate = name;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${name} ${suffix}`;
  return candidate;
}
