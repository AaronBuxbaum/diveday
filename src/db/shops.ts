import { asc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { shops } from "./schema";

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
}

export async function getShopById(db: AppDb, id: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  return shop ?? null;
}

/** Sets which diver medical questionnaire the shop's waivers present. */
export async function setShopJurisdiction(db: AppDb, shopId: string, jurisdiction: "rstc" | "uk") {
  const [shop] = await db
    .update(shops)
    .set({ jurisdiction })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/** Replaces the shop-wide diver packing checklist after route-level validation. */
export async function setShopPackingList(db: AppDb, shopId: string, packingList: string[]) {
  const [shop] = await db
    .update(shops)
    .set({ packingList })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Replaces the shop's rental catalog — which gear it rents. The route narrows
 * the incoming values to known kinds (src/lib/rentals.ts) before calling this,
 * so an unknown string can never be stored.
 */
export async function setShopRentalItems(db: AppDb, shopId: string, rentalItems: string[]) {
  const [shop] = await db
    .update(shops)
    .set({ rentalItems })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets the front-desk address published on the shop's public pages. Empty
 * strings clear the field rather than publishing a blank contact, so a shop can
 * take itself back off the public page by emptying the box.
 */
export async function setShopContact(
  db: AppDb,
  shopId: string,
  contact: { contactEmail: string; contactPhone: string },
) {
  const [shop] = await db
    .update(shops)
    .set({
      contactEmail: contact.contactEmail.trim() || null,
      contactPhone: contact.contactPhone.trim() || null,
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * The shop public pages serve. Single-shop instance for now — multi-shop
 * routing (slug subpaths or domains) arrives with shop onboarding.
 */
export async function getDefaultShop(db: AppDb) {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  return shop ?? null;
}
