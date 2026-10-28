import type { ShopSwitch } from "./shop-features";
import type { StaffDestinationId } from "./staff-destinations";

/**
 * **Is this a feature a shop could run without?** (Aaron, 2026-10-23: "when
 * we add new features they are considered for the list.")
 *
 * Every staff destination and every boolean on `shops` answers here, once:
 * either the Features-page switch it belongs to, or `core` with the one-line
 * reason no shop could go without it. Both maps are total, so a new
 * destination fails typecheck until it is classified, and a new boolean
 * column fails `feature-coverage.test.ts` until it is.
 *
 * The answer is not only paperwork. A destination mapped to a switch leaves
 * the nav, the section tabs and ⌘K when that switch is off
 * (`staffDestinationOffered`), so classifying one is also wiring it.
 */
export type FeatureCoverage =
  | ShopSwitch
  | { readonly anyOf: readonly ShopSwitch[] }
  | { readonly core: string };

export const STAFF_DESTINATION_COVERAGE: Record<StaffDestinationId, FeatureCoverage> = {
  today: { core: "daily operations: the shop home" },
  divers: { core: "daily operations: the people the shop dives with" },
  board: { core: "daily operations: the schedule" },
  addBooking: { core: "daily operations: seating a diver" },
  inbox: { core: "daily operations: what divers write" },
  orders: { core: "daily operations: the money taken" },
  staffing: "crewSchedule",
  lostFound: "lostFound",
  diveSites: { core: "feeds every briefing and manifest" },
  boats: "divingOptions",
  tripTags: { core: "a register; empty until the shop adds a tag" },
  safetyChecklist: { core: "safety" },
  waivers: { core: "safety" },
  safety: { core: "safety: the month's incidents" },
  gear: { core: "a register shown by presence; fleet service clocks are safety" },
  workOrders: "workOrders",
  newWorkOrder: "workOrders",
  rentOut: { core: "gear rental is not switched yet: nitrox lives in the rental items" },
  courses: { core: "shown by presence: a shop that teaches nothing never sees it" },
  reviews: "reviews",
  requests: "dateRequests",
  reports: { core: "the money record" },
  // Money's Discounts tab holds three prices: codes, the last-minute deals and
  // the door to dive packages. It stays while any of them is on, and shows
  // only those (`promos/page.tsx`).
  promoCodes: { anyOf: ["promoCodes", "lastMinuteList", "divePackages"] },
  settings: { core: "admin" },
  team: { core: "admin" },
  activity: { core: "admin: the record of who did what" },
  calendarFeed: { core: "personal: the reader's own calendar" },
  emailSettings: { core: "personal: the reader's own email" },
  security: { core: "personal: the reader's own sign-in" },
};

/**
 * Every boolean column on `shops`, by its Drizzle name. `feature-coverage.test.ts`
 * reads the table and fails naming any boolean not listed here.
 */
export const SHOP_BOOLEAN_COVERAGE: Record<string, FeatureCoverage> = {
  taxEnabled: "tax",
  hasBoatDiving: "divingOptions",
  hasShoreDiving: "divingOptions",
  hasPoolDiving: "divingOptions",
  crewScheduleEnabled: "crewSchedule",
  reviewsEnabled: "reviews",
  dateRequestsEnabled: "dateRequests",
  lastMinuteListEnabled: "lastMinuteList",
  tipsEnabled: "tips",
  publicYearEnabled: "publicYear",
  padiChecksEnabled: "padiChecks",
  claudeSuggestionsEnabled: "claudeSuggestions",
  recapAssistAutoApprove: "recapAutoApprove",
  lostFoundEnabled: "lostFound",
  workOrdersEnabled: "workOrders",
  promoCodesEnabled: "promoCodes",
  divePackagesEnabled: "divePackages",
  offersHotelPickup: "hotelPickup",
  checkoutRecoveryEnabled: "checkoutRecovery",
  buddyLinksEnabled: "buddyLinks",
  sightingsEnabled: "sightings",
  diverPhotosEnabled: "diverPhotos",
  selfRegistrationEnabled: "selfRegistration",
  waitlistEnabled: "waitlist",
  pastDiverInvitesEnabled: "pastDiverInvites",
  helpRequestsEnabled: "helpRequests",
  partnerLinksEnabled: "partnerLinks",
  weekOutReminderEnabled: "weekOutReminder",
  publicConditionsEnabled: "publicConditions",
  fieldGuideEnabled: "fieldGuide",
  isDemo: { core: "platform marker for a demo shop, not a shop's choice" },
  packingLogbook: { core: "a line of the packing list, set beside it in Settings" },
  requireAdultBuddyForTeens: { core: "junior diver safety policy for the shop" },
};

/**
 * The switches a destination belongs to (it is offered while any is on), or
 * null when it is core.
 */
export function destinationSwitches(id: StaffDestinationId): readonly ShopSwitch[] | null {
  const coverage = STAFF_DESTINATION_COVERAGE[id];
  if (typeof coverage === "string") return [coverage];
  return "anyOf" in coverage ? coverage.anyOf : null;
}
