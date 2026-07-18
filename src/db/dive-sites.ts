import { and, asc, eq } from "drizzle-orm";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import {
  type DiveSpecialty,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  globalDiveSites,
  globalDiveSiteVersions,
} from "./schema";

export type DiveSiteInput = {
  shopId: string;
  name: string;
  description?: string;
  locationName?: string;
  satelliteImageUrl?: string;
  routeImageUrl?: string;
  imageUrls?: string[];
  marineLife?: string;
  marineLifeDescription?: string;
  difficulty?: string;
  depthRange?: string;
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
    .where(eq(diveSites.shopId, shopId))
    .orderBy(asc(diveSites.name));
}

export async function getDiveSite(db: AppDb, shopId: string, siteId: string) {
  const [site] = await db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId)))
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
    .where(and(eq(diveSites.id, siteId), eq(diveSites.shopId, shopId)))
    .returning();
  return site ?? null;
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
    satelliteImageUrl: source.satelliteImageUrl ?? undefined,
    routeImageUrl: source.routeImageUrl ?? undefined,
    imageUrls: source.imageUrls,
    marineLife: source.marineLife ?? undefined,
    marineLifeDescription: source.marineLifeDescription ?? undefined,
    difficulty: source.difficulty ?? undefined,
    depthRange: source.depthRange ?? undefined,
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
      sourceTemplateId: row.template.id,
      sourceTemplateVersion: row.version.version,
      imageUrls: briefing.imageUrls ?? [],
      landmarks: briefing.landmarks ?? [],
    })
    .returning();
  return site ?? null;
}
