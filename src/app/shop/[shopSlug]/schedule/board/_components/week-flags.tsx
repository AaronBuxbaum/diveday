import Link from "next/link";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { tapTargetLinkClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import type { WeekDeparture } from "./WeekBoard";

/**
 * What a departure on the board is standing in that a person has to sort out
 * (issue #4474): divers the desk saw at the dock whose seat has not come back,
 * and people on two overlapping departures. The same reads as the departure's
 * own panels.
 */
export type WeekConflictCounts = { dock: number; clashes: number };

export type ConflictFlagCopy = {
  /** "{count} waiting at the dock" / its screen-reader name, with `{ref}`. */
  dockWaiting: string;
  dockWaitingAria: string;
  /** "{count} booked twice" / its screen-reader name, with `{ref}`. */
  bookedTwice: string;
  bookedTwiceAria: string;
};

/**
 * **The loudest thing this board can say** (DOM-H3): the boat is back and
 * somebody on its list was never counted. It is the same fact, the same tone
 * and the same destination as the stream's row badge — a departure that
 * shouted at 1279px and went quiet at 1280 would make the desktop board the
 * worst place in the app to notice a diver nobody has accounted for.
 *
 * Drawn mark and words together, never hue alone, and it **outranks** the
 * price flag rather than stacking with it: one slot, one grammar (issue 758,
 * the same call the stream made).
 *
 * Both flags are a 44px target that ends at its words (`FLAG_CLASS`), lifted
 * over the row's own door.
 */
export function RollCallFlag({
  departure,
  shopSlug,
  copy,
}: {
  departure: WeekDeparture & { rollCallOpen: { diveNumber: number; uncounted: number } };
  shopSlug: string;
  copy: { rollCallOpen: string; rollCallOpenAria: string };
}) {
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest?checkpoint=after_dive_${departure.rollCallOpen.diveNumber}`}
      aria-label={fill(copy.rollCallOpenAria, {
        ref: departure.ref,
        dive: departure.rollCallOpen.diveNumber,
      })}
      className={`${FLAG_CLASS} text-danger`}
    >
      <DiveDayIcon name="warning" className="size-3.5" />
      {fill(copy.rollCallOpen, { count: departure.rollCallOpen.uncounted })}
    </Link>
  );
}

/**
 * **A departure with something for a person to sort out** (issue #4474): a
 * diver at the dock with no seat outranks a person booked twice, because the
 * first is somebody standing there now. Links to the departure's own panel.
 * Warning ink, glyph and words: overlaps are warnings, never refusals.
 */
export function ConflictFlag({
  departure,
  shopSlug,
  copy,
}: {
  departure: WeekDeparture & { conflicts?: WeekConflictCounts | null };
  shopSlug: string;
  copy: ConflictFlagCopy;
}) {
  const conflicts = departure.conflicts;
  if (!conflicts) return null;
  const dock = conflicts.dock > 0;
  const count = dock ? conflicts.dock : conflicts.clashes;
  return (
    <Link
      href={`/shop/${shopSlug}/trips/${departure.tripId}#${dock ? "dock" : "clashes"}`}
      aria-label={fill(dock ? copy.dockWaitingAria : copy.bookedTwiceAria, {
        ref: departure.ref,
        count,
      })}
      className={`${FLAG_CLASS} text-warning-strong`}
    >
      <DiveDayIcon name="warning" className="size-3.5" />
      {fill(dock ? copy.dockWaiting : copy.bookedTwice, { count })}
    </Link>
  );
}

/**
 * **A flag is its own target, over the row's door** (pixel-craft class 7). It
 * was a block `flex` link with no floor: 16px tall, and at 390 228px wide for
 * 90px of words, its hit area running the whole column. `tapTargetLinkClass`
 * gives it the 44px floor and ends its box at its words; `relative z-10`
 * stands it above the row's stretched link, so a tap on it is a tap on it.
 * No margin above it: the 44px box's own band is the room under the title.
 */
export const FLAG_CLASS = `${tapTargetLinkClass} relative z-10 gap-1.5 text-xs font-semibold hover:underline`;
