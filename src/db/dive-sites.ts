import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type DiveSiteDifficulty, parseDiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import { DEFAULT_ROUTE_ZOOM, type RoutePoint } from "@/lib/dive-site-route";
import {
  type DiveSiteTemplateUndo,
  type DiveSiteTemplateUpdateMode,
  diveSiteTemplateDiff,
  diveSiteTemplateSnapshot,
  diveSiteTemplateSnapshotFromSite,
  mergedDiveSiteTemplateSnapshot,
} from "@/lib/dive-site-template-sync";
import type { CertificationLevel } from "@/lib/readiness";
import { type AppDb, type DbExecutor, violatesUniqueIndex } from "./client";
import { isMarineLifeSlug, type MarineLifeSlug } from "./marine-life-catalog";
import { offsetPage } from "./paging";
import {
  type DiveSiteFitTone,
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
  /** How demanding the site is, as a code (`src/lib/dive-site-difficulty.ts`). */
  difficultyLevel?: DiveSiteDifficulty | null;
  depthRange?: string;
  /** Canonical metres, whatever unit the shop typed it in (src/lib/depth-units.ts). */
  maxDepthMeters?: number | null;
  /** This site's own time in the water; null/undefined leaves the shop's figure standing. */
  expectedBottomTimeMinutes?: number | null;
  currentNote?: string;
  divePlan?: string;
  /** Which fit reading the briefing shows; null/undefined derives it (src/lib/diver-planning.ts). */
  fitTone?: DiveSiteFitTone | null;
  fitNote?: string;
  fieldGuideTipsHeading?: string;
  landmarks?: DiveSiteLandmark[] | string[];
  /**
   * The species this site's field guide shows, in order — replaced wholesale on
   * every save, since it is a list the staffer edits as one thing and a diff
   * would only be a slower way to reach the same rows. Undefined leaves the
   * existing guide alone, which is what a caller that does not manage creatures
   * (the CSV import, a copy) means.
   */
  creatures?: readonly MarineLifeSlug[];
  /** The site's inherent cert gate; composed into every trip that visits it. */
  minimumCertificationLevel?: CertificationLevel | null;
  requiredSpecialties?: DiveSpecialty[];
  requiresNitrox?: boolean;
  /** Waypoints the shop clicked onto the satellite frame (src/lib/dive-site-route.ts). */
  routePoints?: RoutePoint[];
  routeLabel?: string;
  routeNote?: string;
  /** The zoom those waypoints were drawn at, and must be rendered at. */
  routeZoom?: number;
};

export async function listDiveSites(db: AppDb, shopId: string) {
  return db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .orderBy(asc(diveSites.name));
}

/**
 * The sites that answer "how long is a dive here?" for themselves, name and
 * minutes, alphabetically.
 *
 * `expected_bottom_time_minutes` overrides `shops.bottom_time_minutes` wherever
 * the dock-day rhythm is laid over a departure, and until this reader existed
 * the number could not be seen from anywhere except the one box that wrote it —
 * least of all from Settings, whose preview of the shop's own rhythm is exactly
 * the thing an override contradicts.
 *
 * A shop that has overridden nothing gets an empty list, and the surface renders
 * nothing extra.
 */
export async function listSiteBottomTimeOverrides(db: AppDb, shopId: string) {
  const rows = await db
    .select({
      id: diveSites.id,
      name: diveSites.name,
      minutes: diveSites.expectedBottomTimeMinutes,
    })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shopId),
        isNull(diveSites.deletedAt),
        isNotNull(diveSites.expectedBottomTimeMinutes),
      ),
    )
    .orderBy(asc(diveSites.name));
  return rows.flatMap((row) => (row.minutes == null ? [] : [{ ...row, minutes: row.minutes }]));
}

/**
 * Where this shop dives, as one coordinate — the anchor the settings address
 * search ranks its suggestions around.
 *
 * A shop's storefront is near the water it takes people to, so its own dive
 * sites are the best position this app already holds; nothing else in the
 * schema carries a lat/lng for a shop. The forecast coordinate is staff-chosen
 * and already trusted to fetch that site's marine forecast, so it is a real
 * point rather than an inference.
 *
 * Returns null when the shop has no site with both coordinates — a brand-new
 * shop, or one that has only named its sites. The caller falls back to an
 * unbiased search (`WORLD_BOUNDING_BOX` in `src/lib/address-lookup.ts`) rather
 * than inventing a centre.
 *
 * Ordered by name, so the same shop gets the same anchor on every keystroke:
 * a bias that wobbles between sites would reshuffle a list the staffer is
 * mid-way through reading.
 */
export async function shopSearchAnchor(
  db: AppDb,
  shopId: string,
): Promise<{ longitude: number; latitude: number } | null> {
  const [site] = await db
    .select({ latitude: diveSites.forecastLatitude, longitude: diveSites.forecastLongitude })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shopId),
        isNull(diveSites.deletedAt),
        isNotNull(diveSites.forecastLatitude),
        isNotNull(diveSites.forecastLongitude),
      ),
    )
    .orderBy(asc(diveSites.name))
    .limit(1);
  if (site?.latitude == null || site?.longitude == null) return null;
  return { longitude: site.longitude, latitude: site.latitude };
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

/**
 * What a site write answers with when the shop already holds that name.
 *
 * A code, never a sentence, like everything else `src/db` returns — the two
 * site forms map it to their own message key.
 */
export const SITE_NAME_TAKEN = "name_taken";

/** A site write's outcome, or the one collision the database decides. */
export type DiveSiteWrite<T> = T | typeof SITE_NAME_TAKEN;

/**
 * Run one site write, converting `dive_sites_shop_name_unique` into an answer.
 *
 * The (shop_id, name) index is the one rule a form parse cannot check: it takes
 * the whole shop's library to know, and a concurrent save could take the name
 * in the gap between a read and the write anyway. So the database is the
 * arbiter, and this turns its refusal into a value the caller can word.
 *
 * Matched by **index name** rather than by SQLSTATE alone: a site write also
 * touches `dive_site_creatures`, and a 23505 from anywhere else is a bug that
 * must keep travelling rather than be reported to a staffer as a name clash.
 *
 * Unhandled, this was a 500: a real 2026-08-14 production save of "Christ of
 * the Abyss" threw out of the server action and took twenty fields of typing
 * with it. Note the index does not exclude archived sites, so the name can be
 * held by a row the staffer cannot see — which is why the wording names them.
 */
async function refusingNameClash<T>(write: () => Promise<T>): Promise<DiveSiteWrite<T>> {
  try {
    return await write();
  } catch (error) {
    if (violatesUniqueIndex(error, "dive_sites_shop_name_unique")) return SITE_NAME_TAKEN;
    throw error;
  }
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
      difficultyLevel: input.difficultyLevel ?? null,
      depthRange: input.depthRange || null,
      expectedBottomTimeMinutes: input.expectedBottomTimeMinutes ?? null,
      currentNote: input.currentNote || null,
      divePlan: input.divePlan || null,
      fitTone: input.fitTone ?? null,
      fitNote: input.fitNote || null,
      fieldGuideTipsHeading: input.fieldGuideTipsHeading || null,
      landmarks: input.landmarks ?? [],
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiredSpecialties: input.requiredSpecialties ?? [],
      requiresNitrox: input.requiresNitrox ?? false,
      routePoints: input.routePoints ?? [],
      routeLabel: input.routeLabel || null,
      routeNote: input.routeNote || null,
      routeZoom: input.routeZoom ?? DEFAULT_ROUTE_ZOOM,
      templateUpdateUndo: null,
    })
    .returning();
  if (!site) throw new Error("createDiveSite: insert returned no row");
  if (input.creatures) await replaceDiveSiteCreatures(db, input.shopId, site.id, input.creatures);
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
      difficultyLevel: input.difficultyLevel ?? null,
      depthRange: input.depthRange || null,
      // `?? null` rather than `|| null`: 0 is not a real site depth, but the
      // distinction still matters — an omitted field clears the column, which
      // is how a shop takes a depth back off a site.
      maxDepthMeters: input.maxDepthMeters ?? null,
      expectedBottomTimeMinutes: input.expectedBottomTimeMinutes ?? null,
      currentNote: input.currentNote || null,
      divePlan: input.divePlan || null,
      fitTone: input.fitTone ?? null,
      fitNote: input.fitNote || null,
      fieldGuideTipsHeading: input.fieldGuideTipsHeading || null,
      landmarks: input.landmarks ?? [],
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiredSpecialties: input.requiredSpecialties ?? [],
      requiresNitrox: input.requiresNitrox ?? false,
      // Same `??`/`||` split as the fields above: an omitted route clears the
      // line off the site, which is how a shop takes one back down.
      routePoints: input.routePoints ?? [],
      routeLabel: input.routeLabel || null,
      routeNote: input.routeNote || null,
      routeZoom: input.routeZoom ?? DEFAULT_ROUTE_ZOOM,
      // A normal save supersedes the one-time inverse of a template pull. This
      // prevents a later Undo from clobbering edits made after the pull.
      templateUpdateUndo: null,
    })
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)))
    .returning();
  if (!site) return null;
  // Only when the caller manages the guide. An undefined list means "leave it
  // alone", which is what the CSV import and any other partial writer means —
  // an empty array is the staffer clearing the guide, and those are different
  // things.
  if (input.creatures) await replaceDiveSiteCreatures(db, shopId, siteId, input.creatures);
  return site;
}

/**
 * `createDiveSite` for the form a staffer types into: a name the shop already
 * holds comes back as `SITE_NAME_TAKEN` to be worded, rather than thrown.
 *
 * The bare writers above stay as they are, because their two internal callers —
 * "Copy and tailor" and the template import — each pick a free name for
 * themselves (`availableSiteName`) and have nothing to say to a staffer if that
 * ever loses a race.
 */
export function createDiveSiteForForm(db: AppDb, input: DiveSiteInput) {
  return refusingNameClash(() => createDiveSite(db, input));
}

/** `updateDiveSite` for the form a staffer types into. See `createDiveSiteForForm`. */
export function updateDiveSiteForForm(
  db: AppDb,
  shopId: string,
  siteId: string,
  input: DiveSiteInput,
) {
  return refusingNameClash(() => updateDiveSite(db, shopId, siteId, input));
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
  // The field guide travels with the copy. A "copy and tailor" that produced a
  // site with the same reef and no species on it was handing the staffer half
  // the briefing back to retype.
  const sourceCreatures = await listDiveSiteCreatures(db, shopId, siteId);
  return createDiveSite(db, {
    creatures: sourceCreatures
      .map((creature) => creature.catalogSlug ?? "")
      .filter(isMarineLifeSlug),
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
    difficultyLevel: source.difficultyLevel,
    depthRange: source.depthRange ?? undefined,
    maxDepthMeters: source.maxDepthMeters,
    expectedBottomTimeMinutes: source.expectedBottomTimeMinutes,
    currentNote: source.currentNote ?? undefined,
    divePlan: source.divePlan ?? undefined,
    fitTone: source.fitTone,
    fitNote: source.fitNote ?? undefined,
    fieldGuideTipsHeading: source.fieldGuideTipsHeading ?? undefined,
    landmarks: source.landmarks,
    minimumCertificationLevel: source.minimumCertificationLevel,
    requiredSpecialties: source.requiredSpecialties,
    requiresNitrox: source.requiresNitrox,
    routePoints: source.routePoints,
    routeLabel: source.routeLabel ?? undefined,
    routeNote: source.routeNote ?? undefined,
    routeZoom: source.routeZoom,
  });
}

export async function listDiveSiteCreatures(db: DbExecutor, shopId: string, siteId: string) {
  return (
    db
      .select()
      .from(diveSiteCreatures)
      .where(and(eq(diveSiteCreatures.shopId, shopId), eq(diveSiteCreatures.diveSiteId, siteId)))
      // The order the shop put them in. Unordered, this query returned whatever
      // the planner produced, so a briefing could reshuffle its own field guide
      // between two renders of the same page; `id` is the tiebreak that keeps the
      // order total for rows written in one batch at the same position.
      .orderBy(asc(diveSiteCreatures.position), asc(diveSiteCreatures.id))
  );
}

/**
 * Replace one site's whole field guide with the species the staffer just chose.
 *
 * Delete-then-insert rather than a per-row diff: the editor hands back the list
 * as one value (order included), so matching rows up would be a slower route to
 * the same end state. Creature rows carry nothing anyone can reference — no
 * booking, no readiness, no audit trail hangs off one — so replacing them loses
 * nothing, which is exactly why they are safe to treat this way and the site
 * row itself is not.
 *
 * A row is a slug and a position. The words are DiveDay's and are resolved per
 * reader at render (ADR 20260813-marine-life-is-diveday-copy); the legacy text
 * columns are left null and are read by nothing.
 */
export async function replaceDiveSiteCreatures(
  db: DbExecutor,
  shopId: string,
  siteId: string,
  species: readonly MarineLifeSlug[],
): Promise<void> {
  await db
    .delete(diveSiteCreatures)
    .where(and(eq(diveSiteCreatures.shopId, shopId), eq(diveSiteCreatures.diveSiteId, siteId)));
  if (species.length === 0) return;
  await db.insert(diveSiteCreatures).values(
    species.map((slug, index) => ({
      shopId,
      diveSiteId: siteId,
      catalogSlug: slug,
      position: index,
    })),
  );
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
      )
      .orderBy(asc(diveSiteCreatures.position), asc(diveSiteCreatures.id)),
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
  options: {
    page?: number;
    limit?: number;
    shopCoordinates?: { latitude: number; longitude: number } | null;
  } = {},
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
    fetchRows: async (offset, limit) => {
      const order = options.shopCoordinates
        ? asc(
            sql<number>`((${globalDiveSiteVersions.briefing}->>'forecastLatitude')::numeric - ${options.shopCoordinates.latitude}) * ((${globalDiveSiteVersions.briefing}->>'forecastLatitude')::numeric - ${options.shopCoordinates.latitude}) + ((${globalDiveSiteVersions.briefing}->>'forecastLongitude')::numeric - ${options.shopCoordinates.longitude}) * ((${globalDiveSiteVersions.briefing}->>'forecastLongitude')::numeric - ${options.shopCoordinates.longitude})`,
          )
        : asc(globalDiveSites.slug);

      return db
        .select({ template: globalDiveSites, version: globalDiveSiteVersions })
        .from(globalDiveSites)
        .innerJoin(globalDiveSiteVersions, currentVersionJoin)
        .orderBy(order)
        .limit(limit)
        .offset(offset);
    },
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
 * One published template by slug, at its current version — what the catalog's
 * preview reads.
 *
 * By slug rather than id, because the slug is what a preview URL carries: it is
 * stable, human-readable in a shared link, and the same identifier
 * `./dive-site-templates.ts` publishes under. Null for a slug that names
 * nothing, which the caller renders as the catalog rather than a 404 — a stale
 * link to a withdrawn template should land a staffer on the list, not on an
 * error.
 */
export async function getGlobalDiveSiteTemplate(
  db: AppDb,
  slug: string,
): Promise<GlobalDiveSiteTemplateRow | null> {
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
    .where(eq(globalDiveSites.slug, slug))
    .limit(1);
  return row ?? null;
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

export type DiveSiteTemplateUpdate = {
  templateName: string;
  currentVersion: number;
  latestVersion: number;
  legacyBaseline: boolean;
  diff: ReturnType<typeof diveSiteTemplateDiff>;
};

/**
 * The current published revision for one shop-owned site, with a field-level
 * diff against the version that site started from. Historical catalog rows are
 * immutable, so they provide the baseline without adding another snapshot
 * column to the shop's briefing.
 */
export async function getDiveSiteTemplateUpdate(
  db: AppDb,
  shopId: string,
  siteId: string,
): Promise<DiveSiteTemplateUpdate | null> {
  const site = await getDiveSite(db, shopId, siteId);
  if (!site?.sourceTemplateId || site.sourceTemplateVersion == null) return null;

  const [template] = await db
    .select()
    .from(globalDiveSites)
    .where(eq(globalDiveSites.id, site.sourceTemplateId))
    .limit(1);
  if (!template || template.currentVersion <= site.sourceTemplateVersion) return null;

  const [latestVersion, baselineVersion] = await Promise.all([
    db
      .select()
      .from(globalDiveSiteVersions)
      .where(
        and(
          eq(globalDiveSiteVersions.globalDiveSiteId, template.id),
          eq(globalDiveSiteVersions.version, template.currentVersion),
        ),
      )
      .limit(1),
    db
      .select()
      .from(globalDiveSiteVersions)
      .where(
        and(
          eq(globalDiveSiteVersions.globalDiveSiteId, template.id),
          eq(globalDiveSiteVersions.version, site.sourceTemplateVersion),
        ),
      )
      .limit(1),
  ]);
  const latest = latestVersion[0];
  if (!latest) return null;
  const creatures = await listDiveSiteCreatures(db, shopId, siteId);
  const currentSnapshot = diveSiteTemplateSnapshotFromSite({
    ...site,
    creatures: creatures.map((creature) => creature.catalogSlug ?? "").filter(isMarineLifeSlug),
  });
  const baseline = baselineVersion[0]
    ? diveSiteTemplateSnapshot(baselineVersion[0].briefing)
    : null;
  const latestSnapshot = diveSiteTemplateSnapshot(latest.briefing);
  return {
    templateName: latest.briefing.name,
    currentVersion: site.sourceTemplateVersion,
    latestVersion: latest.version,
    legacyBaseline: baseline === null,
    diff: diveSiteTemplateDiff(currentSnapshot, baseline, latestSnapshot),
  };
}

/** Apply a reviewed catalog revision without replacing local media or route work. */
export async function pullDiveSiteTemplateUpdates(
  db: AppDb,
  shopId: string,
  siteId: string,
  mode: DiveSiteTemplateUpdateMode,
) {
  return db.transaction(async (tx) => {
    const [site] = await tx
      .select()
      .from(diveSites)
      .where(
        and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)),
      )
      .for("update");
    if (!site?.sourceTemplateId || site.sourceTemplateVersion == null) {
      return { status: "unavailable" as const };
    }

    const [template] = await tx
      .select()
      .from(globalDiveSites)
      .where(eq(globalDiveSites.id, site.sourceTemplateId))
      .limit(1);
    if (!template || template.currentVersion <= site.sourceTemplateVersion) {
      return { status: "unavailable" as const };
    }
    const latestVersion = await tx
      .select()
      .from(globalDiveSiteVersions)
      .where(
        and(
          eq(globalDiveSiteVersions.globalDiveSiteId, template.id),
          eq(globalDiveSiteVersions.version, template.currentVersion),
        ),
      )
      .limit(1);
    const baselineVersion = await tx
      .select()
      .from(globalDiveSiteVersions)
      .where(
        and(
          eq(globalDiveSiteVersions.globalDiveSiteId, template.id),
          eq(globalDiveSiteVersions.version, site.sourceTemplateVersion),
        ),
      )
      .limit(1);
    const latest = latestVersion[0];
    if (!latest) return { status: "unavailable" as const };

    const creatures = await listDiveSiteCreatures(tx, shopId, siteId);
    const currentSnapshot = diveSiteTemplateSnapshotFromSite({
      ...site,
      creatures: creatures.map((creature) => creature.catalogSlug ?? "").filter(isMarineLifeSlug),
    });
    const baseline = baselineVersion[0]
      ? diveSiteTemplateSnapshot(baselineVersion[0].briefing)
      : null;
    const latestSnapshot = diveSiteTemplateSnapshot(latest.briefing);
    const diff = diveSiteTemplateDiff(currentSnapshot, baseline, latestSnapshot);
    const merged = mergedDiveSiteTemplateSnapshot(currentSnapshot, baseline, latestSnapshot, mode);
    const [updated] = await tx
      .update(diveSites)
      .set({
        description: merged.description,
        locationName: merged.locationName,
        forecastLatitude: merged.forecastLatitude,
        forecastLongitude: merged.forecastLongitude,
        marineLife: merged.marineLife,
        marineLifeDescription: merged.marineLifeDescription,
        difficultyLevel: merged.difficultyLevel,
        depthRange: merged.depthRange,
        maxDepthMeters: merged.maxDepthMeters,
        expectedBottomTimeMinutes: merged.expectedBottomTimeMinutes,
        currentNote: merged.currentNote,
        divePlan: merged.divePlan,
        fitTone: merged.fitTone,
        fitNote: merged.fitNote,
        fieldGuideTipsHeading: merged.fieldGuideTipsHeading,
        landmarks: merged.landmarks,
        minimumCertificationLevel: merged.minimumCertificationLevel,
        requiredSpecialties: merged.requiredSpecialties,
        requiresNitrox: merged.requiresNitrox,
        sourceTemplateVersion: latest.version,
        templateUpdateUndo: {
          sourceTemplateVersion: site.sourceTemplateVersion,
          snapshot: currentSnapshot,
        } satisfies DiveSiteTemplateUndo,
      })
      .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId)))
      .returning();
    if (!updated) return { status: "unavailable" as const };
    await replaceDiveSiteCreatures(tx, shopId, siteId, merged.creatures);
    return { status: "updated" as const, mode, diff, site: updated };
  });
}

/** Restore the managed fields from the last template pull, once. */
export async function undoDiveSiteTemplateUpdate(db: AppDb, shopId: string, siteId: string) {
  return db.transaction(async (tx) => {
    const [site] = await tx
      .select()
      .from(diveSites)
      .where(
        and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId), isNull(diveSites.deletedAt)),
      )
      .for("update");
    const undo = site?.templateUpdateUndo;
    if (!site || !undo) return { status: "unavailable" as const };

    const [restored] = await tx
      .update(diveSites)
      .set({
        description: undo.snapshot.description,
        locationName: undo.snapshot.locationName,
        forecastLatitude: undo.snapshot.forecastLatitude,
        forecastLongitude: undo.snapshot.forecastLongitude,
        marineLife: undo.snapshot.marineLife,
        marineLifeDescription: undo.snapshot.marineLifeDescription,
        difficultyLevel: undo.snapshot.difficultyLevel,
        depthRange: undo.snapshot.depthRange,
        maxDepthMeters: undo.snapshot.maxDepthMeters,
        expectedBottomTimeMinutes: undo.snapshot.expectedBottomTimeMinutes,
        currentNote: undo.snapshot.currentNote,
        divePlan: undo.snapshot.divePlan,
        fitTone: undo.snapshot.fitTone,
        fitNote: undo.snapshot.fitNote,
        fieldGuideTipsHeading: undo.snapshot.fieldGuideTipsHeading,
        landmarks: undo.snapshot.landmarks,
        minimumCertificationLevel: undo.snapshot.minimumCertificationLevel,
        requiredSpecialties: undo.snapshot.requiredSpecialties,
        requiresNitrox: undo.snapshot.requiresNitrox,
        sourceTemplateVersion: undo.sourceTemplateVersion,
        templateUpdateUndo: null,
      })
      .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId)))
      .returning();
    if (!restored) return { status: "unavailable" as const };
    await replaceDiveSiteCreatures(tx, shopId, siteId, undo.snapshot.creatures);
    return { status: "undone" as const, site: restored };
  });
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
  // `creatureSlugs` names catalog rows rather than repeating their words, so it
  // is not a site column — it is resolved here into the shop's own field-guide
  // rows, which the shop then edits like anything else it typed.
  // `difficulty` is dropped along with `creatureSlugs`: neither is a column on
  // the shop's row any more. A version published before 2026-08-13 still holds
  // free text there, so it is narrowed rather than ignored — every value any
  // template ever carried is one of the three codes.
  const { creatureSlugs, difficulty, difficultyLevel, ...columns } = briefing;
  const [site] = await db
    .insert(diveSites)
    .values({
      shopId,
      ...columns,
      difficultyLevel: difficultyLevel ?? parseDiveSiteDifficulty(difficulty),
      name: await availableSiteName(db, shopId, briefing.name),
      sourceTemplateId: row.template.id,
      sourceTemplateVersion: row.version.version,
      imageUrls: briefing.imageUrls ?? [],
      landmarks: briefing.landmarks ?? [],
    })
    .returning();
  if (!site) return null;
  // A slug the catalog no longer carries is dropped rather than imported as a
  // blank card: an older published version can outlive a species entry, and a
  // shop should get one species fewer, not one nameless tile.
  const creatures = (creatureSlugs ?? []).filter(isMarineLifeSlug);
  if (creatures.length > 0) await replaceDiveSiteCreatures(db, shopId, site.id, creatures);
  return site;
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
