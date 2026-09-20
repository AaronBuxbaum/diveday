/**
 * **The seats behind the week's bars**, and the one line that heads it.
 *
 * Tide draws a week as a run of days, each holding its boats, and each boat as
 * a bar that fills with the seats sold (ADR 20260919-one-idea, decision I ·
 * Tide, slice 23f — "the week is a pinch"). A bar is a picture of a number, and
 * the arithmetic behind a picture is where it comes to lie about the number, so
 * it lives here with its own tests rather than inline in a `style={{ width }}`.
 *
 * Framework-free and copy-free: what a bar *says* is `src/i18n`'s, what a bar
 * *is* is this.
 */

/** What a bar needs to know about one departure. */
export type SeatCount = {
  booked: number;
  capacity: number;
};

/**
 * The share of a departure's seats that are sold, as 0…1 — the bar's width.
 *
 * **Clamped at both ends, and never `NaN`.** A shop can set a capacity of zero
 * (a course with no cap, a departure mid-setup), and `0/0` is `NaN`, which
 * CSS drops silently: the bar renders at its container's full width, so the
 * one departure nobody can book reads as the one that sold out. An overbooked
 * boat — a capacity lowered under a live roster, which `src/db/bookings.ts`
 * permits because the alternative is refusing the shop its own hull — fills
 * the bar and no further; the *count* beside it still says 13 of 12, because
 * the bar is the glance and the number is the truth.
 */
export function seatFill({ booked, capacity }: SeatCount): number {
  if (!Number.isFinite(booked) || !Number.isFinite(capacity) || capacity <= 0) return 0;
  return Math.min(1, Math.max(0, booked / capacity));
}

/** A departure with every seat sold, and at least one seat to sell. */
export function isSoldOut({ booked, capacity }: SeatCount): boolean {
  return capacity > 0 && booked >= capacity;
}

/**
 * The week's own line — "62 of 84 seats".
 *
 * **Every departure in the week, sailed ones included.** A Thursday boat that
 * came home at noon still sold its seats, and a tally that dropped it would
 * shrink as the week ran: the same week would read 62 of 84 on Monday and 24 of
 * 36 on Friday, which is a number nobody could act on and two shops could not
 * compare. The week is a period, not a forecast.
 *
 * A multi-day course counts once. That is the caller's to honour, and it comes
 * free from `weekBoard` (`src/db/trips-queries.ts`), which renders a span
 * *instead of* the day cells it covers rather than as well as them.
 */
export function weekSeatTally(entries: Iterable<SeatCount>): { taken: number; total: number } {
  let taken = 0;
  let total = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.booked) || !Number.isFinite(entry.capacity)) continue;
    // Capacity floors at the booked count so the line cannot read "13 of 12
    // seats" for the week: an overbooked boat is a fact about that boat, and a
    // reader scanning the header for how full the week is needs a fraction
    // that is one at most. The boat's own row still states its real numbers.
    taken += Math.max(0, entry.booked);
    total += Math.max(0, entry.capacity, entry.booked);
  }
  return { taken, total };
}
