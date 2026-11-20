import type { ReactNode } from "react";
import { EyebrowWayUp } from "@/components/EyebrowWayUp";
import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";

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
  backLabel,
  locale,
  timeZone,
  badge,
  description,
  extraMeta,
  actions,
  actionsClassName,
  price,
  daySpan,
  facts,
  className,
  stackActionsOnPhone = false,
}: {
  trip: { title: string; startsAt: Date; endsAt: Date };
  /** The manifest retains a way out when boat mode hides global navigation. */
  backLabel?: string;
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
  /** Surface-owned visibility, such as the manifest's phone-only emergency door. */
  actionsClassName?: string;
  /**
   * Below `sm`, the actions take a row of their own after the facts. For a
   * header with two doors ("Roll call" and "More"), which beside the title
   * took half a phone's width and broke the name into three lines; one
   * small "More" keeps the title's row.
   */
  stackActionsOnPhone?: boolean;
  /** Optional fare shown with the departure's date and time. */
  price?: ReactNode;
  /**
   * "3 days · Fri, Oct 23 – Sun, Oct 25" for a departure meeting on more than
   * one day, in place of the first day's date and hours (item 26).
   */
  daySpan?: string;
  /**
   * The trip's facts in one line, already worded: date, time, boat and where
   * to meet (the Trip page's header, ADR 20261117-trip-page-clock). In place
   * of the date and price.
   */
  facts?: readonly string[];
  /** Allows a surface to tighten the space after its masthead when needed. */
  className?: string;
}) {
  // **Two doors on a phone follow the facts** (`stackActionsOnPhone`).
  // Sharing the title's row, "Roll call" and "More" took half of a 390px
  // screen, and "Two-Tank Reef — Molasses & French" broke into three lines
  // with "— Molasses" leading one. From `sm` they end the title's row,
  // centred on it. Static strings: Tailwind cannot see an interpolated class.
  const row = backLabel ? "row-start-2" : "row-start-1";
  const smRow = backLabel ? "sm:row-start-2" : "sm:row-start-1";
  const actionSlot = actions ? (
    <div
      className={`flex flex-wrap items-center gap-x-1 gap-y-2 ${
        stackActionsOnPhone
          ? `order-last mt-3 sm:order-none sm:col-start-2 sm:mt-0 ${smRow}`
          : `col-start-2 ${row}`
      } ${actionsClassName ?? ""}`}
    >
      {actions}
    </div>
  ) : null;

  return (
    <header
      className={`grid ${
        stackActionsOnPhone
          ? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-8"
          : "grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:gap-x-8"
      } ${className ?? "mb-8"}`}
    >
      {/* Boat mode hides global navigation, so its header keeps a way back. */}
      {backLabel ? (
        <div className="col-span-full">
          <EyebrowWayUp>{backLabel}</EyebrowWayUp>
        </div>
      ) : null}
      <h1
        className={`${backLabel ? TRIP_TITLE_GAP : ""} min-w-0 ${TRIP_TITLE_TYPE} font-semibold tracking-tight text-balance`}
      >
        {trip.title}
      </h1>
      {actionSlot}
      {/* One geometry for every trip, whatever the length of its name: the
          name owns its line; beneath it, the trip's own facts — when it
          sails, what this surface is for, and any per-surface metadata. */}
      <div
        className={`${TRIP_META_GAP} flex flex-wrap items-center gap-x-3 gap-y-2 col-span-full ${TRIP_META_TYPE} text-muted`}
      >
        {badge}
        {facts ? (
          <span>{facts.join(" · ")}</span>
        ) : (
          <span>
            {daySpan ?? (
              <>
                {formatShortDate(trip.startsAt, locale, timeZone)} ·{" "}
                {formatTimeRangeTz(trip.startsAt, trip.endsAt, locale, timeZone)}
              </>
            )}
            {price ? <span> · {price}</span> : null}
          </span>
        )}
      </div>
      {description ? (
        <p className="mt-2 max-w-2xl text-muted col-span-full">{description}</p>
      ) : null}
      {extraMeta ? (
        <div className="mt-2 flex flex-col gap-1.5 col-span-full">{extraMeta}</div>
      ) : null}
    </header>
  );
}

/**
 * {@link TripPageHeader} drawn as bars, for a trip sub-page's `loading.tsx`
 * (K-188). `/prep` used `<ShopPageHeader pending>`, which is the other header: no
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
  showBack = true,
  className = "mb-8",
}: {
  /** Tailwind width classes for the title bars. */
  titleWidth?: string;
  /** How many lines the boat's name wraps to — see `SkeletonLines`. */
  titleLines?: SkeletonLines;
  /** The header leads its date row with the capacity pill (every page but the manifest). */
  badge?: boolean;
  /** Whether the loaded header has the parent link. */
  showBack?: boolean;
  /** As on the header: the Trip page stacks it in the page's `space-y-10`. */
  className?: string;
}) {
  return (
    <div className={className}>
      {showBack ? <div className="h-4 w-16 rounded bg-surface-sunken" /> : null}
      <div className={showBack ? TRIP_TITLE_GAP : undefined}>
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
