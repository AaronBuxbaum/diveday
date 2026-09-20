import Link from "next/link";
import type { ReactNode } from "react";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
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
 * The header a departure's sub-pages wear — `/manifest`, `/prep`, `/guests`
 * and the printed packet. The departure itself wears `VoyageHeader`, its hour
 * over its own sky.
 *
 * Each is one reading of one departure, so the identity of the departure — its
 * name, how full it is, when it sails — renders here once and identically
 * across them. What stays per-surface is only what genuinely differs: the
 * `description` (what *this* one is for), the `actions` (its own doors), and
 * `extraMeta` for facts that belong to one reading of the trip.
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
  /** Optional fare shown with the departure's date and time. */
  price?: ReactNode;
  /** Allows a surface to tighten the space after its masthead when needed. */
  className?: string;
}) {
  return (
    <header className={className ?? "mb-8"}>
      {/* **The way back up.** These are the deepest pages in the staff app and
          were once the only ones at depth 2-3 with no link to their parent at
          all: the first link in the header was a tab strip, which moved you
          *sideways* between one departure's own pages and never back up (issue
          #823). A crew member who has finished a roll call and wants the next
          boat had the global nav or the browser's back button — on a phone in
          boat-mode, on a deck, the nav is the dock at the bottom of the
          screen: reachable, but a jump out of the departure rather than a step
          up from it.

          The strip is gone now (ADR 20260919-one-idea, slice 23c) and this is
          the only way up, which is why these three name the **departure** they
          are readings of rather than the board two levels above it.
          `print:hidden` because `print/page.tsx` wears this header too and a
          paper sheet has no navigation. */}
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
    </header>
  );
}

/**
 * **A door out of the departure, wearing the band's own chip.**
 *
 * One of these, for the manifest: the departure lost its tab strip in slice
 * 23c (ADR 20260919-one-idea) and every other surface folded into the page,
 * but the manifest could not — `?checkpoint=` is a URL contract with external
 * deep-links, a service worker and an encrypted offline store hanging off it.
 * So it is reached the way the hour is read, from the band.
 *
 * Same `sky` variant and the same reason as `TripAddDiverLink` below it: the
 * accent measures 1.76:1 against `--sky-day`, so a link standing on the sky
 * brings its own opaque box or it is not there.
 */
export function TripSurfaceLink({
  href,
  label,
  icon,
  onSky = false,
}: {
  href: string;
  label: string;
  icon: Parameters<typeof DiveDayIcon>[0]["name"];
  onSky?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        onSky
          ? buttonClass({ variant: "sky", size: "sm", className: "gap-1.5" })
          : buttonClass({ variant: "link", className: "gap-1.5" })
      }
    >
      <DiveDayIcon name={icon} className="size-4" />
      {label}
    </Link>
  );
}

/**
 * A masthead door that points at the "Add a diver" band further down the page.
 *
 * **Link weight, not primary.** One act, two primaries: this jump and the
 * band's own "Add diver" submit were both solid, 1,200px apart on desktop and
 * one scroll apart on a phone, so the page offered a staffer a choice between
 * two spellings of the same thing (docs/design/principles.md §8, and
 * forms-and-controls.md's "Action rows"). The band is where the act actually
 * happens — it holds the search, the candidates and the hand-entry path — so
 * the band keeps the primary and this becomes what it is: a way down the page.
 */
export function TripAddDiverLink({
  href,
  label,
  compactLabel = label,
  ariaLabel,
  onSky = false,
}: {
  href: string;
  label: string;
  compactLabel?: string;
  /** Distinguishes the masthead jump from the inline add form for assistive tech. */
  ariaLabel?: string;
  /**
   * `VoyageHeader` stands this door on a `SkyBand`, where `link`'s accent
   * measured 1.76:1 against `--sky-day` — see the `sky` variant. On the sky it
   * becomes the band's own chip; everywhere else it stays a link, because a
   * chip on the page's ground would be the second primary this component's
   * note above exists to prevent.
   */
  onSky?: boolean;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      // `buttonClass`, not a hand-rolled twin of it: this used to type its own
      // class string and had drifted to `font-semibold` and a `sm:`
      // re-statement of its own radius. The glyph and the width-forked label
      // are the children.
      className={
        onSky
          ? buttonClass({ variant: "sky", size: "sm", className: "gap-1.5" })
          : buttonClass({ variant: "link", className: "gap-1.5" })
      }
    >
      <DiveDayIcon name="addBooking" className="size-4" />
      <span className="sm:hidden">{compactLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}
