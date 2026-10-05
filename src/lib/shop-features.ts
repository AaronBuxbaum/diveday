/**
 * **The optional features a shop can switch off** (ADR
 * 20261005-optional-shop-features).
 *
 * Each is a boolean on `shops`, on by default, and each is a feature a shop
 * can run without: DiveDay's own star ratings, divers asking for a day that is
 * not on the board, the last-minute deals list, and tips on the recap. Off
 * hides the feature on every surface that offers it and deletes nothing, so
 * turning it back on finds everything where it was.
 *
 * The crew schedule is the same idea with its own rule (`crew-schedule.ts`),
 * because switching it off also has to keep a safety count honest.
 */
export const SHOP_FEATURES = ["reviews", "dateRequests", "lastMinuteList", "tips"] as const;

export type ShopFeature = (typeof SHOP_FEATURES)[number];

/** The `shops` columns behind each feature, as Drizzle names them. */
export const SHOP_FEATURE_COLUMNS = {
  reviews: "reviewsEnabled",
  dateRequests: "dateRequestsEnabled",
  lastMinuteList: "lastMinuteListEnabled",
  tips: "tipsEnabled",
} as const satisfies Record<ShopFeature, string>;

export type ShopFeatureColumn = (typeof SHOP_FEATURE_COLUMNS)[ShopFeature];

export type ShopFeatureFlags = Record<ShopFeatureColumn, boolean>;

/** Whether the shop offers one optional feature. */
export function shopOffers(shop: ShopFeatureFlags, feature: ShopFeature): boolean {
  return shop[SHOP_FEATURE_COLUMNS[feature]];
}

/** Narrows an untrusted form value to a feature, or null. */
export function parseShopFeature(value: unknown): ShopFeature | null {
  return typeof value === "string" && (SHOP_FEATURES as readonly string[]).includes(value)
    ? (value as ShopFeature)
    : null;
}
