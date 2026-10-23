import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { AssistDarkReason } from "@/lib/claude/dark";
import { SHOP_FEATURES, type ShopFeature } from "@/lib/shop-features";

/**
 * **The Features page's one list** (issue #2814, Aaron 2026-10-17): every
 * on/off switch a shop owns, once. Nine switches were drawn in seven places
 * (six optional features in four groups, the crew schedule, Stripe Tax, and
 * which kinds of diving the shop runs); they are rows of one page now, in the
 * order the issue names them.
 *
 * A row is **only the switch**. Value settings (the divemaster target, the
 * pass-through fee) stay where they were; a row that has one links to it once
 * it is on. Off hides the feature and deletes nothing (`shop-features.ts`).
 *
 * **Each row keeps its own gate**, the one its switch had before it moved:
 * the six optional features are shop settings; tips and Stripe Tax are
 * payment settings; the crew schedule is the team's. The four predicates
 * resolve to owner and manager today and each states its own reason so one can
 * move without dragging the others (`action-helpers.ts`). The page hides a row
 * its reader may not flip and the action re-checks it, row by row.
 */
export type FeatureRowGate = "settings" | "payments" | "team";

/** The three switches that are not one of `SHOP_FEATURES`. */
type OtherFeatureRow = "crewSchedule" | "tax" | "divingOptions";

export type FeatureRowId = ShopFeature | OtherFeatureRow;

export type FeatureRow = {
  id: FeatureRowId;
  gate: FeatureRowGate;
  /** The row's name, on the page and in ⌘K. */
  headingKey: StaffMessageKey;
  /** Where its value settings live; shown beside the switch once it is on. */
  link?: { path: string; labelKey: "settings.features.crewTarget" | "settings.features.boats" };
};

const OPTIONAL_FEATURE_GATES: Record<ShopFeature, FeatureRowGate> = {
  reviews: "settings",
  dateRequests: "settings",
  lastMinuteList: "settings",
  tips: "payments",
  publicYear: "settings",
  padiChecks: "settings",
  claudeSuggestions: "settings",
  recapAutoApprove: "settings",
};

const OPTIONAL_FEATURE_HEADINGS: Record<ShopFeature, StaffMessageKey> = {
  reviews: "settings.main.features.reviews.heading",
  dateRequests: "settings.main.features.dateRequests.heading",
  lastMinuteList: "settings.main.features.lastMinuteList.heading",
  tips: "settings.main.features.tips.heading",
  publicYear: "settings.main.features.publicYear.heading",
  padiChecks: "settings.main.features.padiChecks.heading",
  claudeSuggestions: "settings.main.features.claudeSuggestions.heading",
  recapAutoApprove: "settings.main.features.recapAutoApprove.heading",
};

/** The optional features, in this page's order (not `SHOP_FEATURES`'). */
const OPTIONAL_ORDER = [
  "reviews",
  "tips",
  "dateRequests",
  "lastMinuteList",
  "publicYear",
  "padiChecks",
  "claudeSuggestions",
  "recapAutoApprove",
] as const satisfies readonly ShopFeature[];

export const FEATURE_ROWS: readonly FeatureRow[] = [
  ...OPTIONAL_ORDER.map(
    (id): FeatureRow => ({
      id,
      gate: OPTIONAL_FEATURE_GATES[id],
      headingKey: OPTIONAL_FEATURE_HEADINGS[id],
    }),
  ),
  {
    id: "crewSchedule",
    gate: "team",
    headingKey: "settings.main.crewSchedule.heading",
    link: { path: "/settings#crew-schedule", labelKey: "settings.features.crewTarget" },
  },
  { id: "tax", gate: "payments", headingKey: "settings.main.tax.heading" },
  {
    id: "divingOptions",
    gate: "settings",
    headingKey: "boats.divingOptionsHeading",
    link: { path: "/boats", labelKey: "settings.features.boats" },
  },
];

/** Narrows an untrusted form value to a row, or null. */
export function parseFeatureRow(value: unknown): FeatureRow | null {
  return FEATURE_ROWS.find((row) => row.id === value) ?? null;
}

/** Whether `id` is one of the six optional features in `shop-features.ts`. */
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
  demo_shop: "settings.main.features.claudeSuggestions.dark.demoShop",
  over_cap: "settings.main.features.claudeSuggestions.dark.overCap",
};

/** The line under the AI switch, or null when there is nothing to explain. */
export function darkWhileOnKey(reason: AssistDarkReason | null): StaffMessageKey | null {
  return reason === null || reason === "shop_off" ? null : DARK_WHILE_ON[reason];
}
