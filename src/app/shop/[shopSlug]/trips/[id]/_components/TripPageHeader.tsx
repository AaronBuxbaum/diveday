import type { ReactNode } from "react";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { capacityLabel, isFull, type TripCapacity } from "@/lib/trips";

/**
 * How full the boat is, or that it isn't sailing — the one pill that leads the
 * header on every tab that has the capacity numbers in hand.
 *
 * A sold-out boat is a win worth noticing, not a quiet state
 * (docs/design/principles.md #3): "success" stands out where "neutral" would
 * recede. Cancelled outranks both — a full cancelled trip is not a full trip.
 */
export function TripCapacityBadge({
  trip,
  cancelledLabel,
  t,
}: {
  trip: TripCapacity & { status: string };
  cancelledLabel: string;
  t: StaffTranslator;
}) {
  if (trip.status === "cancelled") return <Badge tone="danger">{cancelledLabel}</Badge>;
  const capacity = capacityLabel(trip);
  return (
    <Badge tone={isFull(trip) ? "success" : "primary"} tabularNums>
      {capacity.kind === "full"
        ? t("shared.capacity.full")
        : t("shared.capacity.spotsLeft", { count: capacity.remaining })}
    </Badge>
  );
}

/**
 * The one header every trip surface wears.
 *
 * The four tabs — Overview, Guests, Manifest, Prep — are four readings of one
 * departure, and they used to announce it four different ways: three rendered
 * `ShopPageHeader` under a "TRIPS" eyebrow (a word that named the section a
 * staffer had just tapped through, above a tab bar that already said which
 * surface they were on), while the Manifest hand-rolled its own `<h1>` at a
 * different size with a rule under it. Two showed the seats badge, two didn't;
 * the date line was `mt-1` on one and inside `meta` on the others. Switching
 * tabs re-drew the top of the page for no reason a reader could act on.
 *
 * So the identity of the departure — its name, how full it is, when it sails —
 * is rendered here once, identically, on all four. What stays per-tab is only
 * what genuinely differs: the `description` (what *this* surface is for), the
 * `actions` (its own doors), and `extraMeta` for facts that belong to one
 * reading of the trip, like Overview's dive sites or its multi-day schedule.
 */
export function TripPageHeader({
  title,
  startsAt,
  endsAt,
  locale,
  timeZone,
  badge,
  description,
  extraMeta,
  actions,
}: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  locale: string;
  /** The shop's own zone — never the host's. See `src/lib/format.ts`. */
  timeZone: string;
  /**
   * How full the boat is, or that the trip is cancelled. Optional because the
   * Manifest deliberately has none: its whole body is a live head count, and a
   * "3 spots left" pill above a roll call reading "6 of 9 aboard" invites a
   * reader to treat the seat count as a boarding count.
   */
  badge?: ReactNode;
  description?: string;
  /** Rows below the date line that belong to this surface's reading of the trip. */
  extraMeta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <ShopPageHeader
      title={title}
      description={description}
      actions={actions}
      meta={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            {badge}
            <span className="text-muted">
              {formatShortDate(startsAt, locale, timeZone)} ·{" "}
              {formatTimeRangeTz(startsAt, endsAt, locale, timeZone)}
            </span>
          </div>
          {extraMeta}
        </div>
      }
    />
  );
}
