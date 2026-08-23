import type { ReactNode } from "react";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
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
 * departure, so the identity of the departure — its name, how full it is, when
 * it sails — renders here once, identically, on all four. What stays per-tab is
 * only what genuinely differs: the `description` (what *this* surface is for),
 * the `actions` (its own doors), and `extraMeta` for facts that belong to one
 * reading of the trip, like Overview's dive sites or its multi-day schedule.
 *
 * The boat's name owns the line. It used to share its row with a shrink-proof
 * actions column, so "Two-Tank Reef — French Reef" wrapped at half measure
 * while three quiet controls kept a whole column to themselves; now the
 * actions wrap in after the title and drop below it the moment the name needs
 * the room, which on a phone is exactly the stack the old layout collapsed to
 * anyway.
 */
export function TripPageHeader({
  trip,
  boardHref,
  backLabel,
  locale,
  timeZone,
  badge,
  description,
  extraMeta,
  actions,
}: {
  trip: { title: string; startsAt: Date; endsAt: Date };
  /** This shop's schedule board — the parent every trip surface belongs to. */
  boardHref: string;
  /** The nav's own word for it, so the two cannot drift (issue #824). */
  backLabel: string;
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
    <header className="mb-8">
      {/* **The way back up.** These four surfaces are the deepest pages in the
          staff app and were the only ones at depth 2-3 with no link to their
          parent at all: the first link in the header was the sub-tab strip,
          which moves you *sideways* between one departure's own pages and
          never back to the board you came from (issue #823). A crew member who
          has finished a roll call and wants the next boat had the global nav
          or the browser's back button — on a phone in boat-mode, on a deck,
          the nav is the dock at the bottom of the screen: reachable, but a jump
          out of the departure rather than a step up from it.

          The word is the nav's own, from `STAFF_DESTINATION_LABEL_KEYS`, so
          the eyebrow and the tab that highlights for these routes can never
          come to call one place two things. `print:hidden` because
          `print/page.tsx` wears this header too and a paper sheet has no
          navigation. */}
      <EyebrowBackLink href={boardHref} className="mb-2 print:hidden">
        {backLabel}
      </EyebrowBackLink>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">{trip.title}</h1>
      {/* One geometry for every trip, whatever the length of its name: the
          name owns its line; beneath it, the trip's own facts — when it sails
          (reading size, not a footnote — a staffer glances here all day), what
          this surface is for, where it dives — read as one column, with the
          page's doors to the right of them from `sm` up and *after* them on a
          phone, so utility controls never interleave between the date and the
          identity line. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-x-6">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-muted">
            {badge}
            <span>
              {formatShortDate(trip.startsAt, locale, timeZone)} ·{" "}
              {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, timeZone)}
            </span>
          </div>
          {description ? <p className="max-w-2xl text-muted">{description}</p> : null}
          {extraMeta ? <div className="flex flex-col gap-1.5">{extraMeta}</div> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-start gap-x-1 gap-y-2 sm:shrink-0">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
