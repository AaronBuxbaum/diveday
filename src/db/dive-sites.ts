import { and, asc, count, eq, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { offsetPage } from "./paging";
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

/** Three rows of cards on the widest grid the library page uses. */
export const DIVE_SITE_PAGE_SIZE = 24;

export type DiveSiteListFilter = {
  /** Matched against the site name *and* its location — staff recall either. */
  query?: string;
};

/**
 * One screenful of the library, searchable. A shop that has been running for
 * years holds far more sites than fit on a page, and the library rendered every
 * one of them as a card with no way to find anything except scrolling.
 *
 * The library page reads through here; every other caller keeps using
 * `listDiveSites`, which deliberately still returns the lot because the trip
 * editor's `<select>` of sites cannot page.
 *
 * The name half of the search rides `dive_sites_name_trgm_idx` (the GIN
 * trigram index the command palette added); the location half is a scan
 * within one shop's rows, which is the right trade at a library's scale —
 * a second trigram index would cost every write to buy nothing measurable.
 */
export async function listDiveSitesPage(
  db: AppDb,
  shopId: string,
  filter: DiveSiteListFilter = {},
  page: { page?: number; pageSize?: number } = {},
) {
  const like = filter.query?.trim() ? `%${filter.query.trim()}%` : undefined;
  const where = and(
    eq(diveSites.shopId, shopId),
    isNull(diveSites.deletedAt),
    // A null `locationName` simply never matches — `ilike` on NULL is NULL,
    // which `or` treats as "not this branch" rather than excluding the row.
    like ? or(ilike(diveSites.name, like), ilike(diveSites.locationName, like)) : undefined,
  );
  // Through the shared `offsetPage` rather than its own arithmetic: this used
  // to clamp `?page=0`/`-3`/`abc` itself but had no answer for a page *past*
  // the end, so a bookmarked `?page=9` on a library that shrank to four pages
  // rendered an empty table under "Page 9 of 4". Landing on the last real page
  // is the rule for every paged staff list (ADR 20260803-one-pagination-model),
  // and it belongs in one place.
  return offsetPage({
    page: page.page,
    pageSize: page.pageSize ?? DIVE_SITE_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db.select({ total: count() }).from(diveSites).where(where);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select()
        .from(diveSites)
        .where(where)
        // `dive_sites_shop_name_unique` already makes the name a total order
        // within a shop, so no row can land on two pages or on none; `id` is the
        // belt-and-braces tiebreak that keeps that true if the index is ever
        // relaxed (e.g. to let an archived site free its name).
        .orderBy(asc(diveSites.name), asc(diveSites.id))
        .limit(limit)
        .offset(offset),
  });
}

/**
 * The three library counters, over the whole shop rather than the page being
 * shown — "Saved sites: 24" on page 1 of 4 would be a lie, and these numbers
 * are the reason the header exists.
 */
export async function diveSiteLibraryStats(db: AppDb, shopId: string) {
  const [row] = await db
    .select({
      total: count(),
      withForecastPoints: sql<number>`count(*) filter (where ${diveSites.forecastLatitude} is not null and ${diveSites.forecastLongitude} is not null)::int`,
      fromTemplates: sql<number>`count(*) filter (where ${diveSites.sourceTemplateId} is not null)::int`,
    })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)));
  return {
    total: row?.total ?? 0,
    withForecastPoints: row?.withForecastPoints ?? 0,
    fromTemplates: row?.fromTemplates ?? 0,
  };
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

/** How many published site templates the "Common dive sites" catalog shows per page. */
export const GLOBAL_DIVE_SITE_PAGE_SIZE = 24;

export type GlobalDiveSiteTemplateRow = {
  template: typeof globalDiveSites.$inferSelect;
  version: typeof globalDiveSiteVersions.$inferSelect;
};

export type GlobalDiveSiteTemplatePage = {
  templates: GlobalDiveSiteTemplateRow[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The DiveDay-published site catalog a shop imports from, one page at a time.
 *
 * This is a catalog we intend to keep adding to — the whole point of it is that
 * a shop anywhere can find its own reef in it — so the surface has to page from
 * the start rather than the day someone notices it renders a thousand cards
 * (AGENTS.md: bound the page, not the capture; ADR
 * 20260803-one-pagination-model). Ordered by slug, which is unique, so the sort
 * needs no tiebreak of its own.
 *
 * The count joins the current-version row exactly as the page does: a template
 * whose `currentVersion` has no matching version row is invisible to both, so
 * neither can promise a card the other cannot render.
 */
export async function listGlobalDiveSiteTemplates(
  db: AppDb,
  options: { page?: number; limit?: number } = {},
): Promise<GlobalDiveSiteTemplatePage> {
  const currentVersionJoin = and(
    eq(globalDiveSiteVersions.globalDiveSiteId, globalDiveSites.id),
    eq(globalDiveSiteVersions.version, globalDiveSites.currentVersion),
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? GLOBAL_DIVE_SITE_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(globalDiveSites)
        .innerJoin(globalDiveSiteVersions, currentVersionJoin);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({ template: globalDiveSites, version: globalDiveSiteVersions })
        .from(globalDiveSites)
        .innerJoin(globalDiveSiteVersions, currentVersionJoin)
        .orderBy(asc(globalDiveSites.slug))
        .limit(limit)
        .offset(offset),
  });

  return {
    templates: paged.rows,
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/**
 * Current published version for the given templates, as a lookup.
 *
 * The library's "a newer version of this site is published" badge needs one
 * number per *imported* site on the page it is rendering, which is a lookup,
 * not a list — so it asks for exactly those ids rather than reading the whole
 * catalog and indexing it client-side. That distinction is what lets the
 * catalog itself page (`listGlobalDiveSiteTemplates`) without the library
 * silently losing badges for anything past page 1.
 *
 * An empty `templateIds` short-circuits: `inArray(col, [])` is a query that can
 * only ever return nothing, and there is no reason to make the database say so.
 */
export async function currentGlobalDiveSiteVersions(
  db: AppDb,
  templateIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(templateIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: globalDiveSites.id, version: globalDiveSites.currentVersion })
    .from(globalDiveSites)
    .where(inArray(globalDiveSites.id, ids));
  return new Map(rows.map((row) => [row.id, row.version]));
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
