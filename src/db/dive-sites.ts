import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { diveSites } from "./schema";

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
  });
}
