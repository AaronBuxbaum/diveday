import { eq, sql } from "drizzle-orm";
import type { RentalPricing } from "@/lib/rentals";
import type { AppDb, DbExecutor } from "./client";
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

/** Sets how many minutes before departure divers are asked to be at the dock. */
export async function setShopDockCallMinutes(db: AppDb, shopId: string, dockCallMinutes: number) {
  const [shop] = await db
    .update(shops)
    .set({ dockCallMinutes })
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
 * Replaces the shop's rental price list (set price, per-piece prices, per-dive
 * nitrox surcharge). The route validates and normalizes amounts to minor units
 * before calling this; a price is never inventory, only what a diver is quoted.
 */
export async function setShopRentalPricing(
  db: AppDb,
  shopId: string,
  rentalPricing: RentalPricing,
) {
  const [shop] = await db
    .update(shops)
    .set({ rentalPricing })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * One-time correction for a shop that priced or received nitrox requests
 * before nitrox existed as an explicit "what we rent" catalog entry: treats
 * that prior pricing or a live per-booking request as the shop's own signal
 * that it already offers nitrox, so shipping the catalog gate doesn't
 * silently take away a request/price a shop was already relying on. Only
 * touches a shop missing the catalog entry (idempotent), so it's safe to run
 * on every cold start alongside `seedIfEmpty` (src/db/client.ts) rather than
 * as a one-shot migration.
 */
export async function backfillLegacyNitroxOffering(db: DbExecutor): Promise<void> {
  await db.execute(sql`
    update shops
    set rental_items = rental_items || '["nitrox"]'::jsonb
    where not (rental_items @> '["nitrox"]'::jsonb)
      and (
        (rental_pricing ->> 'nitroxCents') is not null
        or exists (
          select 1 from bookings
          where bookings.shop_id = shops.id
            and bookings.wants_nitrox = true
            and bookings.status <> 'cancelled'
        )
      )
  `);
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
