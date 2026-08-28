/**
 * A diver's shop history, when part of it happened before DiveDay
 * (ADR 20260725-import-prior-visits).
 *
 * A migrated shop has two sources for the same question — "when has this person
 * dived with us?" — and they are not the same kind of fact. A booking in DiveDay
 * points at a real trip this shop ran here, with a roll call behind it. A prior
 * visit is a line the shop's old system held: a *booking record*, which is
 * evidence someone reserved a seat and not evidence they got wet. This module
 * merges the two into one timeline without letting the second impersonate the
 * first.
 *
 * Framework-free and clock-free on purpose: the ordering rule is the interesting
 * part and it is unit-tested rather than eyeballed in a rendered page.
 */

import { type CalendarDate, calendarDateInTimezone } from "./calendar-date";

/** The prior system's own status word, and what DiveDay is willing to say about it. */
export type PriorVisitStanding = "recorded" | "did_not_happen";

/**
 * Words an export uses for a booking that never became a visit. Matched only to
 * decide *presentation* — a cancelled booking is dimmed and reads "cancelled at
 * the prior shop" rather than sitting in the list looking like a dive — never to
 * rewrite `statusLabel`, which stays verbatim (src/db/schema.ts, `prior_visits`).
 *
 * Deliberately conservative: anything unrecognized stays `recorded`, because the
 * failure mode of over-matching (quietly greying out a visit that did happen) is
 * worse than the failure mode of under-matching (a cancelled row that reads
 * plainly as "Cancelled", which is what the label already says).
 */
const DID_NOT_HAPPEN = /cancel|refund|no.?show|void|declin|abandon|fail|expired|unpaid/i;

export function priorVisitStanding(statusLabel: string | null | undefined): PriorVisitStanding {
  return DID_NOT_HAPPEN.test(statusLabel ?? "") ? "did_not_happen" : "recorded";
}

/** A booking DiveDay itself holds — the trip is real and clickable. */
export type NativeHistoryEntry<TBooking> = {
  kind: "booking";
  /** Shop-local day, the axis both sources share. */
  on: CalendarDate;
  entry: TBooking;
};

/** A booking record carried across from the prior system. */
export type PriorHistoryEntry<TVisit> = {
  kind: "prior_visit";
  on: CalendarDate;
  entry: TVisit;
};

export type HistoryEntry<TBooking, TVisit> =
  | NativeHistoryEntry<TBooking>
  | PriorHistoryEntry<TVisit>;

/**
 * Merge native bookings and imported prior visits into one reverse-chronological
 * timeline (newest first), the order the diver profile reads in.
 *
 * The two sources carry time differently and the difference is real, not a
 * nuisance to paper over: a trip has an instant (`startsAt`, with a zone), while
 * a prior visit has only the calendar day the old export wrote. Comparing them
 * means putting the booking on the shop's own local calendar first — the same
 * shop-local rule certification expiry uses (CR-009) — so a 7am departure and an
 * imported visit on that date land on the same day rather than a UTC-offset
 * apart.
 *
 * Same-day ties put the native booking first. A prior visit is by definition
 * from before this shop ran on DiveDay, so on the one day both can appear (the
 * migration day itself) the record with a real trip behind it leads.
 */
export function mergeShopHistory<TBooking, TVisit>(
  bookings: readonly TBooking[],
  visits: readonly TVisit[],
  read: {
    bookingStartsAt: (booking: TBooking) => Date;
    visitedOn: (visit: TVisit) => CalendarDate;
    timezone: string;
  },
): HistoryEntry<TBooking, TVisit>[] {
  const merged: HistoryEntry<TBooking, TVisit>[] = [
    ...bookings.map(
      (entry): NativeHistoryEntry<TBooking> => ({
        kind: "booking",
        on: calendarDateInTimezone(read.bookingStartsAt(entry), read.timezone),
        entry,
      }),
    ),
    ...visits.map(
      (entry): PriorHistoryEntry<TVisit> => ({
        kind: "prior_visit",
        on: read.visitedOn(entry),
        entry,
      }),
    ),
  ];
  // Calendar dates are ISO YYYY-MM-DD, so lexicographic ordering is chronological.
  return merged.sort((a, b) => {
    if (a.on !== b.on) return a.on < b.on ? 1 : -1;
    if (a.kind === b.kind) return 0;
    return a.kind === "booking" ? -1 : 1;
  });
}

/**
 * How many entries behind the diver the record's story shows before folding
 * the rest.
 *
 * A ten-year regular's imported history is hundreds of rows, and a wall of them
 * buries the cards, sizes and open items a staffer opened the page for. The
 * recent ones are the ones anyone reads; the rest stay one tap away rather than
 * being dropped. Everything still *ahead* of the diver is always shown — a boat
 * they are on is never folded away (ADR 20260827-people-not-lists).
 */
export const SHOP_HISTORY_PREVIEW_COUNT = 10;
