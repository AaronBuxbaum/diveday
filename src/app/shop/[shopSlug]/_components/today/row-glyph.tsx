import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { LedgerRowKindTone } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffDestinationId } from "@/lib/staff-destinations";
import type { ACTION_KIND_META, TodayAction } from "@/lib/today";

/*
 * A Needs you row's leading mark, shared by Today's rows and a departure's
 * Needs you strip (visual review 2026-10-24, A46), so the two draw one kind
 * with one picture.
 */

/** The status family's shape for a row that is wrong, and the ink it takes. */
const ROW_GLYPH = { danger: "danger", warning: "warning" } as const;
const ROW_GLYPH_INK = {
  danger: "text-danger",
  warning: "text-warning-strong",
  neutral: "text-muted",
} as const;

/** Every job kind whose tone is quiet: the rows that lead with their category. */
type QuietKind = {
  [K in keyof typeof ACTION_KIND_META]: (typeof ACTION_KIND_META)[K]["tone"] extends "neutral"
    ? K
    : never;
}[keyof typeof ACTION_KIND_META];

/** The small drawings a quiet row may lead with: a staff destination's, or the boat. */
export type RowIconName = StaffDestinationId | "boat";

/**
 * **A quiet row leads with what it is about, not with an empty circle** (UX
 * review 2026-10-10, item 6). The hollow ring read as a checkbox: the desk
 * tapped it expecting to tick the job off, and nothing happened. A danger or
 * warning row keeps its status shape (the triangle the Waiver row wears); a
 * quiet one wears the drawing of the place its fix lives, from the same
 * family the sidebar draws, so nothing on the row looks pressable that is
 * not. A full record over the quiet kinds, so a new one is a type error until
 * it has a picture.
 */
const QUIET_ROW_ICON: Record<QuietKind, RowIconName> = {
  dive_prep: "gear",
  help_request: "inbox",
  payment: "orders",
  email_delivery: "inbox",
  seat_wanted: "divers",
  emergency_contact: "divers",
  crew_below_target: "staffing",
  reviews_pending: "reviews",
  unanswered_messages: "inbox",
  gear_due_back: "gear",
  gear_service_due: "workOrders",
  boat_papers_due: "boat",
  work_order_uncollected: "workOrders",
  units_unconfirmed: "settings",
  lost_items_waiting: "lostFound",
  rental_fit_confirm: "gear",
};

/** The quiet icon for a kind, or none for a kind that is not quiet. */
export function quietIcon(kind: TodayAction["kind"]): RowIconName | undefined {
  return (QUIET_ROW_ICON as Partial<Record<TodayAction["kind"], RowIconName>>)[kind];
}

/** A row's leading mark: the status shape when something is wrong, the category drawing when not. */
export function RowGlyph({ tone, icon }: { tone: LedgerRowKindTone; icon?: RowIconName }) {
  if (tone === "neutral") {
    return (
      <DiveDayIcon
        name={icon ?? "today"}
        className={`size-5 shrink-0 ${ROW_GLYPH_INK.neutral}`}
        strokeWidth={1.6}
      />
    );
  }
  return <StatusMark variant={ROW_GLYPH[tone]} size="md" className={ROW_GLYPH_INK[tone]} />;
}
