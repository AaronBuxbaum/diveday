import type { ReactNode } from "react";
import { EyebrowBackLink, SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
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
 * The boat's name: its size and its line box, below `sm` and from it. One
 * constant because `TripPageHeaderSkeleton` draws its title bars in this same
 * line box (`h-lh`), so a size change moves the bars with the words.
 */
const TRIP_TITLE_TYPE = "text-[23px] leading-[1.15] sm:text-[34px] sm:leading-[1.12]";

/** Where the title's row and the date row under it sit — the skeleton's too. */
const TRIP_TITLE_GAP = "mt-2";
const TRIP_META_GAP = "mt-1.5 sm:mt-2.5";
/** The date row's type, whose line box the skeleton's date bar is. */
const TRIP_META_TYPE = "text-[13px] sm:text-[15px]";

/**
 * The header every tab of a departure wears — Divers, Details, Check-in, Boat
 * and Gear — and the printed packet.
 *
 * Each is one reading of one departure, so the identity of the departure — its
 * name, how full it is, when it sails — renders here once and identically
 * across them. What stays per-surface is only what genuinely differs: the
 * `description` (what *this* one is for), the `actions` (its own doors), and
 * `extraMeta` for facts that belong to one reading of the trip.
 *
 * The boat's name owns the line. It used to share its row with a shrink-proof
 * actions column, so "Two-Tank Reef — French Reef" wrapped at half measure
 * while three quiet controls kept a whole column to themselves. The one
 * surface with actions (the manifest's ••• menu) now puts them at the end of
 * the title's own row, centred on it at every width; a surface without them
 * gives the title the row alone.
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
      <EyebrowBackLink href={boardHref} className="print:hidden">
        {backLabel}
      </EyebrowBackLink>
      {/* **The title and its actions are one row, centred on each other.**
          The 48px ••• used to sit in a grid cell beside the 16px eyebrow on a
          phone — 16px under the eyebrow's centre, and holding the title 49px
          below it — and from `sm` to top-align beside the title, 4px above
          its line (K-196, K-357). The eyebrow keeps a line of its own at
          every width, and the actions end the title's. */}
      <div className={`${TRIP_TITLE_GAP} flex items-center gap-4 sm:gap-8`}>
        <h1
          className={`min-w-0 flex-1 ${TRIP_TITLE_TYPE} font-semibold tracking-tight text-balance`}
        >
          {trip.title}
        </h1>
        {headerAside || actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            {headerAside}
            {actions ? (
              // Doors ("Add diver", the manifest's •••), never facts: off the
              // paper, as `ShopPageHeader`'s are.
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2 print:hidden">
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* One geometry for every trip, whatever the length of its name: the
          name owns its line; beneath it, the trip's own facts — when it
          sails, what this surface is for, and any per-surface metadata. */}
      <div
        className={`${TRIP_META_GAP} flex flex-wrap items-center gap-x-3 gap-y-2 ${TRIP_META_TYPE} text-muted`}
      >
        {badge}
        <span>
          {formatShortDate(trip.startsAt, locale, timeZone)} ·{" "}
          {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, timeZone)}
          {price ? <> · {price}</> : null}
        </span>
      </div>
      {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
      {extraMeta ? <div className="mt-2 flex flex-col gap-1.5">{extraMeta}</div> : null}
    </header>
  );
}

/**
 * {@link TripPageHeader} drawn as bars, for a trip sub-page's `loading.tsx`
 * (K-188). `/prep` used `ShopPageHeaderSkeleton`, which is the other header: no
 * eyebrow where this one always has its way back, a 44px title line where this
 * one's is 26px on a phone and 38px from `sm`, and a description bar this
 * header draws for none of the pages that wait behind a skeleton. Its packing
 * list landed 12px higher than its bars at 1280.
 *
 * Read off the header above and moving with it: the eyebrow's 16px line
 * (`EYEBROW_TAP_WRAPPER`), the title in `TRIP_TITLE_TYPE`'s own line box, and
 * the date row at `TRIP_META_GAP` — the capacity pill it leads with (`Badge`'s
 * `md`: 4px, a 20px line, 4px) and the date in `TRIP_META_TYPE`'s line box.
 * No actions: the pages that wait behind this draw none.
 */
export function TripPageHeaderSkeleton({
  titleWidth = "w-64 max-w-full",
  titleLines = 1,
  badge = true,
  className = "mb-8",
}: {
  /** Tailwind width classes for the title bars. */
  titleWidth?: string;
  /** How many lines the boat's name wraps to — see `SkeletonLines`. */
  titleLines?: SkeletonLines;
  /** The header leads its date row with the capacity pill (every page but the manifest). */
  badge?: boolean;
  /** As on the header: the Divers tab stacks it in the page's `space-y-10`. */
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="h-4 w-16 rounded bg-surface-sunken" />
      <div className={TRIP_TITLE_GAP}>
        <SkeletonLineBars
          lines={titleLines}
          height={`h-lh ${TRIP_TITLE_TYPE}`}
          width={titleWidth}
        />
      </div>
      <div className={`${TRIP_META_GAP} flex items-center gap-x-3 ${TRIP_META_TYPE}`}>
        {badge ? <div className="h-7 w-24 rounded-full bg-surface-sunken" /> : null}
        <div className="h-lh w-56 max-w-full rounded bg-surface-sunken" />
      </div>
    </div>
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
}: {
  href: string;
  label: string;
  compactLabel?: string;
  /** Distinguishes the masthead jump from the inline add form for assistive tech. */
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      // `buttonClass`, not a hand-rolled twin of it: this used to type its own
      // class string and had drifted to `font-semibold` and a `sm:`
      // re-statement of its own radius. The glyph and the width-forked label
      // are the children.
      className={buttonClass({ variant: "link", className: "gap-1.5 print:hidden" })}
    >
      <DiveDayIcon name="addBooking" className="size-4" />
      <span className="sm:hidden">{compactLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}
