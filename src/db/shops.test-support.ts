import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { SHOP_FEATURE_COLUMNS, type ShopFeature } from "@/lib/shop-features";
import type { AppDb } from "./client";
import { shops } from "./schema";

/** Shop setters the tests arrange with; no product code calls them. */

/** Turns Stripe Tax on or off for charges created after this setting is saved. */
export async function setShopTaxEnabled(db: AppDb, shopId: string, taxEnabled: boolean) {
  const [shop] = await db.update(shops).set({ taxEnabled }).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/**
 * **A human clears a flagged shop name** (issue #2450): the shop's mail goes
 * back to "{Shop} via DiveDay". Stamps the clearing rather than erasing the
 * flag, so a later rename that matches again (a newer flag) holds again. Null
 * for a shop that does not exist; clearing a shop that was never flagged is
 * harmless.
 */
export async function clearShopNameReview(db: AppDb, shopId: string, now: Date = nowDate()) {
  const [shop] = await db
    .update(shops)
    .set({ nameClearedAt: now })
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
 * Replaces the notes Claude reads when it drafts a reply (`shops.reply_notes`).
 * The action trims and caps the box first, so what arrives is text within
 * `REPLY_NOTES_MAX_LENGTH`, or `null` for none.
 */
export async function setShopReplyNotes(db: AppDb, shopId: string, replyNotes: string | null) {
  const [shop] = await db
    .update(shops)
    .set({ replyNotes })
    .where(eq(shops.id, shopId))
    .returning({ id: shops.id });
  return shop ?? null;
}

/** Sets which kinds of diving the shop runs. */
export async function setShopDivingOptions(
  db: AppDb,
  shopId: string,
  options: {
    hasBoatDiving: boolean;
    hasShoreDiving: boolean;
    hasPoolDiving: boolean;
  },
) {
  const [shop] = await db.update(shops).set(options).where(eq(shops.id, shopId)).returning();
  return shop ?? null;
}

/** Turns the shop's crew schedule on or off (`shops.crew_schedule_enabled`). */
export async function setShopCrewScheduleEnabled(
  db: AppDb,
  shopId: string,
  crewScheduleEnabled: boolean,
) {
  const [shop] = await db
    .update(shops)
    .set({ crewScheduleEnabled })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * Turns one optional feature on or off (`src/lib/shop-features.ts`). Nothing
 * the feature wrote is touched, so turning it back on finds everything where
 * it was.
 */
export async function setShopFeature(
  db: AppDb,
  shopId: string,
  feature: ShopFeature,
  enabled: boolean,
) {
  const [shop] = await db
    .update(shops)
    .set({ [SHOP_FEATURE_COLUMNS[feature]]: enabled })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}
