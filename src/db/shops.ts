import { eq } from "drizzle-orm";
import type { DepthUnit } from "@/lib/depth-units";
import type { ShopCurrency } from "@/lib/money";
import type { RentalPricing } from "@/lib/rentals";
import type { TemperatureUnit } from "@/lib/temperature-units";
import type { AppDb } from "./client";
import { shops } from "./schema";

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
}

/**
 * Every publicly-indexable shop, for the sitemap. Demo shops are excluded —
 * including the canonical `blue-mantis` fixture the e2e/visual fleet seeds
 * (docs ADR 20260724-per-visitor-demo-shops) — because a demo is a test
 * fixture a visitor spins up, not a real shop, and has no business in search
 * results.
 */
export async function listShopsForSitemap(db: AppDb): Promise<{ slug: string }[]> {
  return db.select({ slug: shops.slug }).from(shops).where(eq(shops.isDemo, false));
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
 * Sets the zone every date and time in this shop is read and written in.
 *
 * Presentation *and* interpretation: a departure is stored as an instant, but
 * every form that sets one takes a wall-clock time and converts it through
 * this zone, and every surface converts back. Changing it therefore re-reads
 * existing departures at their new local times rather than moving them — which
 * is the right answer for the case this exists for (a shop that never touched
 * the sign-up picker and has been reading its own schedule in US Eastern).
 *
 * The caller validates the id against `isValidTimeZone` first; storing an id
 * this runtime doesn't know would make every formatter on every surface throw.
 */
export async function setShopTimezone(db: AppDb, shopId: string, timezone: string) {
  const [shop] = await db.update(shops).set({ timezone }).where(eq(shops.id, shopId)).returning();
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
 * Sets the currency the shop displays and charges in. Unlike the depth unit
 * below, this is **not** lossless: every stored `*_cents` amount is an integer
 * count of the old currency's minor unit and no conversion happens here, so a
 * shop switching usd → jpy reinterprets a $130.00 trip as ¥13,000. Rows that
 * already settled (orders, checkouts, payments, refunds) carry their own
 * currency and are unaffected — it is the shop's own price list that needs
 * re-checking, which the settings copy says out loud.
 *
 * The route narrows the incoming value through `toShopCurrency` before calling
 * this, so an unsupported code can never be stored.
 */
export async function setShopCurrency(db: AppDb, shopId: string, currency: ShopCurrency) {
  const [shop] = await db.update(shops).set({ currency }).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * Sets whether the shop reads depth in metres or feet. Presentation only —
 * `dive_sites.max_depth_meters` stays canonical metres, so flipping this never
 * changes a stored depth or what a certification ceiling compares against.
 */
export async function setShopDepthUnit(db: AppDb, shopId: string, unit: DepthUnit) {
  const [shop] = await db
    .update(shops)
    .set({ depthUnit: unit })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Sets whether the shop reads water temperature in Celsius or Fahrenheit.
 * Presentation only, on the same terms as the depth unit above —
 * `trips.water_temperature_c` stays canonical Celsius, so flipping this never
 * changes a stored reading. Independent of the depth unit on purpose: a shop
 * that dives in feet and talks about the water in Celsius is a real shop.
 */
export async function setShopTemperatureUnit(db: AppDb, shopId: string, unit: TemperatureUnit) {
  const [shop] = await db
    .update(shops)
    .set({ temperatureUnit: unit })
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
 * Sets the shop's physical business address, published in structured data so
 * search engines can place the shop as a real venue. Each field clears
 * independently on an empty string, so a shop can walk an address back to
 * nothing (or fill in only what it knows, like locality and country) rather
 * than being forced to supply all five at once.
 */
export async function setShopAddress(
  db: AppDb,
  shopId: string,
  address: {
    addressStreet?: string | null;
    addressLocality?: string | null;
    addressRegion?: string | null;
    addressPostalCode?: string | null;
    addressCountry?: string | null;
  },
) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const [shop] = await db
    .update(shops)
    .set({
      addressStreet: clean(address.addressStreet),
      addressLocality: clean(address.addressLocality),
      addressRegion: clean(address.addressRegion),
      addressPostalCode: clean(address.addressPostalCode),
      addressCountry: clean(address.addressCountry),
    })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Where a post-trip review request sends a diver. An empty string clears it —
 * with none set, the recap flow skips the review ask entirely rather than
 * guessing a platform (docs ADR 20260726-post-trip-review-request).
 */
export async function setShopReviewUrl(db: AppDb, shopId: string, reviewUrl: string) {
  const [shop] = await db
    .update(shops)
    .set({ reviewUrl: reviewUrl.trim() || null })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}
