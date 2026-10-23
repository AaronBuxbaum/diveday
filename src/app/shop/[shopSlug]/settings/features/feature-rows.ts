import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { AssistDarkReason } from "@/lib/claude/dark";
import { SHOP_FEATURES, type ShopFeature, type ShopSwitch } from "@/lib/shop-features";

/**
 * **The Features page's one list** (issue #2814, Aaron 2026-10-17): every
 * on/off switch a shop owns, once. Nine switches were drawn in seven places
 * (six optional features in four groups, the crew schedule, Stripe Tax, and
 * which kinds of diving the shop runs); they are rows of one page now, under
 * five small group headings since the list grew past a screen (2026-10-23).
 *
 * A row is **only the switch**. Value settings (the divemaster target, the
 * pass-through fee) stay where they were; a row that has one links to it once
 * it is on. Off hides the feature and deletes nothing (`shop-features.ts`).
 *
 * **Each row keeps its own gate**, the one its switch had before it moved:
 * most optional features are shop settings; the money ones (tips, Stripe
 * Tax, promo codes, packages) are payment settings; the crew schedule is the
 * team's. The four predicates
 * resolve to owner and manager today and each states its own reason so one can
 * move without dragging the others (`action-helpers.ts`). The page hides a row
 * its reader may not flip, and the one Save writes only the rows the page drew
 * and the reader passes the gate of (`save-plan.ts`).
 */
export type FeatureRowGate = "settings" | "payments" | "team";

/** Every switch on the page (`ShopSwitch` in `shop-features.ts`). */
export type FeatureRowId = ShopSwitch;

/**
 * The small headings the list falls under, in page order. A row belongs to
 * exactly one; a group none of whose rows the reader may flip is not drawn.
 */
export const FEATURE_GROUPS = ["diving", "bookings", "divers", "crew", "claude"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export type FeatureRow = {
  id: FeatureRowId;
  group: FeatureGroup;
  gate: FeatureRowGate;
  /** The row's name, on the page and in ⌘K. */
  headingKey: StaffMessageKey;
  /** Where its value settings live; shown beside the switch once it is on. */
  link?: { path: string; labelKey: "settings.features.crewTarget" | "settings.features.boats" };
};

/** An optional feature's row: its words follow `settings.main.features.<id>`. */
function optional(id: ShopFeature, group: FeatureGroup, gate: FeatureRowGate): FeatureRow {
  return { id, group, gate, headingKey: `settings.main.features.${id}.heading` };
}

/**
 * The rows in page order, grouped. Money features (tips, tax, promo codes,
 * packages) keep the payments gate tips always had; the crew schedule keeps
 * the team's; everything else is a shop setting.
 */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  {
    id: "divingOptions",
    group: "diving",
    gate: "settings",
    headingKey: "boats.divingOptionsHeading",
    link: { path: "/boats", labelKey: "settings.features.boats" },
  },
  optional("hotelPickup", "diving", "settings"),
  optional("publicConditions", "diving", "settings"),
  optional("fieldGuide", "diving", "settings"),
  optional("dateRequests", "bookings", "settings"),
  optional("lastMinuteList", "bookings", "settings"),
  optional("promoCodes", "bookings", "payments"),
  optional("divePackages", "bookings", "payments"),
  optional("tips", "bookings", "payments"),
  { id: "tax", group: "bookings", gate: "payments", headingKey: "settings.main.tax.heading" },
  optional("checkoutRecovery", "bookings", "settings"),
  optional("buddyLinks", "bookings", "settings"),
  optional("selfRegistration", "bookings", "settings"),
  optional("waitlist", "bookings", "settings"),
  optional("pastDiverInvites", "bookings", "settings"),
  optional("partnerLinks", "bookings", "settings"),
  optional("reviews", "divers", "settings"),
  optional("publicYear", "divers", "settings"),
  optional("padiChecks", "divers", "settings"),
  optional("sightings", "divers", "settings"),
  optional("diverPhotos", "divers", "settings"),
  optional("weekOutReminder", "divers", "settings"),
  optional("helpRequests", "divers", "settings"),
  {
    id: "crewSchedule",
    group: "crew",
    gate: "team",
    headingKey: "settings.main.crewSchedule.heading",
    link: { path: "/settings#crew-schedule", labelKey: "settings.features.crewTarget" },
  },
  optional("workOrders", "crew", "settings"),
  optional("lostFound", "crew", "settings"),
  optional("claudeSuggestions", "claude", "settings"),
  optional("recapAutoApprove", "claude", "settings"),
];

/** Whether `id` is one of the optional features in `shop-features.ts`. */
export function isOptionalFeature(id: FeatureRowId): id is ShopFeature {
  return (SHOP_FEATURES as readonly string[]).includes(id);
}

/**
 * Why the AI suggestions stay hidden with their switch on (Aaron, 2026-10-23:
 * the switch read on while every page said they were off). `shop_off` needs no
 * line, the switch itself says it.
 */
const DARK_WHILE_ON: Record<Exclude<AssistDarkReason, "shop_off">, StaffMessageKey> = {
  no_key: "settings.main.features.claudeSuggestions.dark.noProvider",
  external_http_disabled: "settings.main.features.claudeSuggestions.dark.noProvider",
  over_cap: "settings.main.features.claudeSuggestions.dark.overCap",
  demo_over_cap: "settings.main.features.claudeSuggestions.dark.demoOverCap",
};

/** The line under the AI switch, or null when there is nothing to explain. */
export function darkWhileOnKey(reason: AssistDarkReason | null): StaffMessageKey | null {
  return reason === null || reason === "shop_off" ? null : DARK_WHILE_ON[reason];
}

/** The notes-for-AI form's anchor under the AI switch, and its `saved` id. */
export const REPLY_NOTES_ROW = "replyNotes";
