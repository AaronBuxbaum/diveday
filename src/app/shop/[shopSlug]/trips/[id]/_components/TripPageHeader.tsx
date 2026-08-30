import type { ReactNode } from "react";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
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
 * The three surfaces — Trip, Manifest, and Prep — are three readings of one
 * departure, so the identity of the departure — its name, how full it is, when
 * it sails — renders here once, identically, on all three. What stays per-tab
 * is only what genuinely differs: the `description` (what *this* surface is
 * for), the `actions` (its own doors), and `extraMeta` for facts that belong
 * to one reading of the trip.
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
  headerAside,
  subNav,
  price,
  className,
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
  /** Primary work on the Trip masthead, such as capacity and Add diver. */
  headerAside?: ReactNode;
  /** The three-surface nav, placed after the identity block. */
  subNav?: ReactNode;
  /** Optional fare shown with the departure's date and time. */
  price?: ReactNode;
  /** Allows a surface to tighten the space after its masthead when needed. */
  className?: string;
}) {
  return (
    <header className={className ?? "mb-8"}>
      {/* **The way back up.** These three surfaces are the deepest pages in the
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 sm:gap-x-8">
        <EyebrowBackLink href={boardHref} className="col-start-1 row-start-1 print:hidden">
          {backLabel}
        </EyebrowBackLink>
        {headerAside || actions ? (
          <div className="col-start-2 row-start-1 flex flex-wrap items-start justify-end gap-2 sm:row-start-2 sm:gap-3">
            {headerAside}
            {actions ? (
              <div className="flex flex-wrap items-start gap-x-1 gap-y-2">{actions}</div>
            ) : null}
          </div>
        ) : null}
        <div className="col-span-2 row-start-2 mt-2 min-w-0 sm:col-span-1 sm:col-start-1 sm:mt-2">
          <h1 className="text-[23px] leading-[1.15] font-semibold tracking-tight text-balance sm:text-[34px] sm:leading-[1.12]">
            {trip.title}
          </h1>
          {/* One geometry for every trip, whatever the length of its name: the
              name owns its line; beneath it, the trip's own facts — when it
              sails, what this surface is for, and any per-surface metadata. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted sm:mt-2.5 sm:text-[15px]">
            {badge}
            <span>
              {formatShortDate(trip.startsAt, locale, timeZone)} ·{" "}
              {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, timeZone)}
              {price ? <> · {price}</> : null}
            </span>
          </div>
          {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
          {extraMeta ? <div className="mt-2 flex flex-col gap-1.5">{extraMeta}</div> : null}
        </div>
      </div>
      {subNav ? <div className="mt-6">{subNav}</div> : null}
    </header>
  );
}

/**
 * Compact capacity read used by the Trip masthead. The ring is a visual
 * summary; the adjacent words keep the exact count available to readers and
 * in high-contrast/forced-colour modes.
 */
export function TripCapacityRing({
  booked,
  capacity,
  seatsLabel,
  openLabel,
}: {
  booked: number;
  capacity: number;
  seatsLabel: string;
  openLabel: string;
}) {
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const progress = capacity > 0 ? Math.min(1, Math.max(0, booked / capacity)) : 0;
  const open = Math.max(0, capacity - booked);
  return (
    <div
      className="flex items-center gap-2 sm:gap-2.5"
      role="img"
      aria-label={`${booked} ${seatsLabel}, ${open} ${openLabel}`}
    >
      <svg className="size-8 shrink-0 sm:size-11" viewBox="0 0 46 46" aria-hidden="true">
        <circle cx="23" cy="23" r={radius} fill="none" className="stroke-border" strokeWidth="5" />
        <circle
          cx="23"
          cy="23"
          r={radius}
          fill="none"
          className="stroke-primary"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${progress * circumference} ${circumference}`}
          transform="rotate(-90 23 23)"
        />
        <text
          x="23"
          y="27"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-bold tabular-nums"
        >
          {booked}
        </text>
      </svg>
      <span className="text-[11px] leading-tight text-muted sm:text-xs">
        {seatsLabel}
        <br />
        {open} {openLabel}
      </span>
    </div>
  );
}

/** A masthead-sized Add diver door that points at the existing inline form. */
export function TripAddDiverLink({
  href,
  label,
  compactLabel = label,
}: {
  href: string;
  label: string;
  compactLabel?: string;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-11 sm:rounded-xl sm:px-4"
    >
      <DiveDayIcon name="addBooking" className="size-4" />
      <span className="sm:hidden">{compactLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}
