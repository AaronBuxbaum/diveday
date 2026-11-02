/**
 * **The optional features a shop can switch off** (ADR
 * 20261005-optional-shop-features).
 *
 * Each is a boolean on `shops`, on by default, and each is a feature a shop
 * can run without: DiveDay's own star ratings,
 * divers asking for a day that is not on the board, the last-minute deals
 * list, tips on the recap, the shopfront's "Our year", the PADI checks
 * (beta), Claude suggestions (ADR 20261018-claude-assists; off, every
 * assist is dark), lost and found, gear servicing (work orders), promo codes,
 * dive packages, hotel pickups, abandoned-checkout emails, bring-a-buddy
 * links, marine-life sightings, recap photos, counter QR
 * self-registration, the waitlist, past-diver invites, day-of help requests,
 * partner links, the week-out reminder, public conditions and the dive-site
 * field guide. Off hides the feature on every surface that offers it and deletes
 * nothing, so turning it back on finds everything where it was.
 *
 * **Every feature starts on for a new shop** (Aaron, 2026-10-23). "Our year"
 * and the PADI checks used to wait for the shop's yes (H-20261014-padi-divechek) and recap
 * highlights without a tap for the crew's; a shop now turns off what it does
 * not want on the Features page. The PADI rule is `agencyCheckOffered` in
 * `agency-check.ts`.
 *
 * The crew schedule is the same idea with its own rule (`crew-schedule.ts`),
 * because switching it off also has to keep a safety count honest.
 */
export const SHOP_FEATURES = [
  "reviews",
  "dateRequests",
  "lastMinuteList",
  "tips",
  "publicYear",
  "padiChecks",
  "claudeSuggestions",
  "recapAutoApprove",
  "lostFound",
  "workOrders",
  "promoCodes",
  "divePackages",
  "hotelPickup",
  "checkoutRecovery",
  "buddyLinks",
  "sightings",
  "diverPhotos",
  "selfRegistration",
  "waitlist",
  "pastDiverInvites",
  "helpRequests",
  "partnerLinks",
  "weekOutReminder",
  "publicConditions",
  "fieldGuide",
] as const;

export type ShopFeature = (typeof SHOP_FEATURES)[number];

/** The `shops` columns behind each feature, as Drizzle names them. */
export const SHOP_FEATURE_COLUMNS = {
  reviews: "reviewsEnabled",
  dateRequests: "dateRequestsEnabled",
  lastMinuteList: "lastMinuteListEnabled",
  tips: "tipsEnabled",
  publicYear: "publicYearEnabled",
  padiChecks: "padiChecksEnabled",
  claudeSuggestions: "claudeSuggestionsEnabled",
  recapAutoApprove: "recapAssistAutoApprove",
  lostFound: "lostFoundEnabled",
  workOrders: "workOrdersEnabled",
  promoCodes: "promoCodesEnabled",
  divePackages: "divePackagesEnabled",
  hotelPickup: "offersHotelPickup",
  checkoutRecovery: "checkoutRecoveryEnabled",
  buddyLinks: "buddyLinksEnabled",
  sightings: "sightingsEnabled",
  diverPhotos: "diverPhotosEnabled",
  selfRegistration: "selfRegistrationEnabled",
  waitlist: "waitlistEnabled",
  pastDiverInvites: "pastDiverInvitesEnabled",
  helpRequests: "helpRequestsEnabled",
  partnerLinks: "partnerLinksEnabled",
  weekOutReminder: "weekOutReminderEnabled",
  publicConditions: "publicConditionsEnabled",
  fieldGuide: "fieldGuideEnabled",
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

/**
 * **Every switch on the Features page**: the optional features above plus the
 * three with rules of their own (the crew schedule, Stripe Tax, and which kinds
 * of diving the shop runs). The guard in `feature-coverage.ts` maps every
 * staff destination and every boolean on `shops` to one of these, or to a
 * written reason it is core.
 */
export type ShopSwitch = ShopFeature | "crewSchedule" | "tax" | "divingOptions";

/** The columns `shopSwitchesOn` reads. */
export type ShopSwitchFlags = ShopFeatureFlags & {
  crewScheduleEnabled: boolean;
  taxEnabled: boolean;
  hasBoatDiving: boolean;
  hasShoreDiving: boolean;
  hasPoolDiving: boolean;
};

/** Which switches are on, by switch. Plain booleans, so it crosses to a Client Component. */
export type ShopSwitchesOn = Record<ShopSwitch, boolean>;

/**
 * Every switch's state for one shop. Diving is on while any kind is (the
 * Features page refuses all three off); the boats register keeps its own gate
 * on boat diving (`staffDestinationGates`).
 */
export function shopSwitchesOn(shop: ShopSwitchFlags): ShopSwitchesOn {
  const on = Object.fromEntries(
    SHOP_FEATURES.map((feature) => [feature, shopOffers(shop, feature)]),
  ) as Record<ShopFeature, boolean>;
  return {
    ...on,
    crewSchedule: shop.crewScheduleEnabled,
    tax: shop.taxEnabled,
    divingOptions: shop.hasBoatDiving || shop.hasShoreDiving || shop.hasPoolDiving,
  };
}

/** Every switch on: the shape a caller with no shop row to read assumes. */
export const ALL_SWITCHES_ON: ShopSwitchesOn = {
  ...(Object.fromEntries(SHOP_FEATURES.map((feature) => [feature, true])) as Record<
    ShopFeature,
    boolean
  >),
  crewSchedule: true,
  tax: true,
  divingOptions: true,
};
