import type { WeekDeparture, WeekEntry, WeekSeats } from "./WeekBoard";

/** A multi-day course session as one bar across the columns it owns. */
export type WeekSpan = WeekDeparture &
  Pick<WeekEntry, "time"> & {
    /** "$595 · Marcus Webb". */
    meta: string;
    seats: WeekSeats;
    /** "4 of 5", printed beside the bar. */
    seatsLabel: string;
    /**
     * "3 days" — how long the course runs, where a boat says when it leaves.
     * Formatted on the server rather than filled from a template here: it needs
     * an ICU plural, and `fill` (`src/i18n/fill.ts`) replaces placeholders
     * without one. A Client Component may format neither a date nor a count.
     */
    runsLabel: string;
    /** 1-based column the bar starts in, and how many columns it covers. */
    startColumn: number;
    columnSpan: number;
  };
