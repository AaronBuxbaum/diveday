/**
 * Stable fixture identifiers shared with browser tests. Keep this module free
 * of imports so discovery does not load the database and full seed graph.
 */

/** The seeded reef booking whose recap link is deterministic. */
export const DEMO_RECAP_BOOKING_ID = "0de3c0de-1eaf-4b0a-9c0f-000000000001";

/** Listed shops beside the canonical demo, with no staff or bookings. */
export const LISTED_SHOP_SLUGS = ["reef-line-divers", "keys-current-charters"] as const;

/** Mantis green, used only when a minted shop requests the brand fixture. */
export const MINTED_DEMO_BRAND_COLOR = "#158462";

/** The boat at sea's names, by day and at dusk (`seed-boat-at-sea.ts`). */
export const AT_SEA_DAY_TITLE = "Two-Tank Reef — Molasses & Pickles";
export const AT_SEA_DUSK_TITLE = "Dusk & Night Two-Tank — French Reef";
