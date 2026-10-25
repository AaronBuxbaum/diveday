import type { EveningClose } from "@/lib/closeout";
import {
  type DaySpine,
  type DayStation,
  rowTone,
  type TodayAction,
  type TodayActionKind,
} from "@/lib/today";

export type SpineEntry =
  | { kind: "live"; at: number; station: DayStation }
  | { kind: "closing"; at: number; close: EveningClose["stations"][number] };

/**
 * **The two halves of one row of stations.** The spine's own stations come
 * from a forward-looking reader, which drops a departure an hour after it
 * leaves; the closing state is read backwards over the whole shop day. So a
 * departure appears in exactly one of them, and merging by `startsAt` is
 * what makes the day read as one column of times settling from the top
 * rather than a board quietly emptying.
 */
export function spineEntries(
  spine: Pick<DaySpine, "stations">,
  close: Pick<EveningClose, "stations"> | undefined,
): { liveTripIds: ReadonlySet<string>; entries: SpineEntry[] } {
  const liveTripIds = new Set(spine.stations.map((station) => station.tripId));
  const liveEntries: SpineEntry[] = spine.stations.map((station) => ({
    kind: "live",
    at: station.startsAt.getTime(),
    station,
  }));
  const closingEntries: SpineEntry[] = (close?.stations ?? [])
    .filter((entry) => !liveTripIds.has(entry.tripId))
    .map((entry) => ({ kind: "closing", at: entry.startsAt.getTime(), close: entry }));
  const entries = [...liveEntries, ...closingEntries].sort((a, b) => a.at - b.at);
  return { liveTripIds, entries };
}

/**
 * **The one coral element, resolved once** (see `DaySpine.tsx`'s docblock).
 * The evening's own moment outranks the morning's; and between the morning's
 * two, the shop's first booking ever outranks a day whose boats happen to be
 * clear, because one of them happens once and the other happens on a good
 * Tuesday.
 *
 * The season's fact outranks the *daily* all-clear and nothing above it
 * (Budget rule 3). It is not a compliment, so it does not wait for a day with
 * no blockers on it — the Home board draws it over a morning with a boarding
 * blocker, which is the day a shop most deserves to be told it is on its four
 * hundredth diver.
 */
export function spineMoment(
  close: Pick<EveningClose, "allHome"> | undefined,
  firstBooking: unknown,
  factOfScale: unknown,
): { allHomeLine: boolean; firstBookingMark: boolean; factOfScaleLine: boolean } {
  const allHomeLine = close?.allHome === true;
  const firstBookingMark = !allHomeLine && firstBooking != null;
  const factOfScaleLine = !allHomeLine && !firstBookingMark && factOfScale != null;
  return { allHomeLine, firstBookingMark, factOfScaleLine };
}

/**
 * **The all-clear, before the wind has its say.** Clear of everything the
 * queue answered; the wind decides the rest (`UnlessWindy`). Never drawn under
 * one of the coral moments above, which outrank it. With no job at all the
 * reading says not clear only for want of one, so a wind row can still be the
 * job the line stands over — but only over a day that has stations and not one
 * blocked diver on them.
 */
export function spineClearUnlessWindy(
  moment: { allHomeLine: boolean; firstBookingMark: boolean; factOfScaleLine: boolean },
  reading: { boatsClear: boolean; jobs: number; blocked: number },
  spine: { stations: readonly { blocked: number }[] },
): boolean {
  if (moment.allHomeLine || moment.firstBookingMark || moment.factOfScaleLine) return false;
  if (reading.boatsClear) return true;
  return (
    reading.jobs === 0 &&
    spine.stations.length > 0 &&
    reading.blocked === 0 &&
    !spine.stations.some((station) => station.blocked > 0)
  );
}

/**
 * **A boat's Needs you rows, by what keeps a diver off the boat** (visual
 * review 2026-10-24, A43). `src/lib/today.ts` ranks by how long a fix takes
 * to land, which put "1 order awaiting payment" above three divers with no
 * emergency contact. Within one boat the desk reads them by boarding impact:
 *
 * 1. readiness and medical, and every danger row (a roll call, a diver not
 *    back aboard, a blocker): anything not named below lands here, so a kind
 *    added later is never ranked under money by omission. A diver's readiness
 *    blocker ranks here whatever its kind: an unpaid seat the shop requires
 *    settled before boarding is kind `payment` too, and it keeps a person off
 *    the boat, so it never sinks to the money tier with the orders row;
 * 2. emergency contact;
 * 3. prep (sizes, kit, a rental fit);
 * 4. money;
 * 5. the rest (a help request, the wait list, an email that bounced).
 *
 * The sort is stable, so `src/lib/today.ts`'s order holds inside a tier, and
 * it never drops or adds a row. H-152's one-row-per-diver grouping happened
 * upstream; this only orders what it produced.
 */
const BOAT_TIER: Partial<Record<TodayActionKind, number>> = {
  emergency_contact: 1,
  dive_prep: 2,
  rental_fit_confirm: 2,
  payment: 3,
  owed_refund: 3,
  payment_dispute: 3,
  stuck_payment_operation: 3,
  payments_restricted: 3,
  help_request: 4,
  seat_wanted: 4,
  email_delivery: 4,
  crew_below_target: 4,
  crew_away: 4,
  failed_photo_deletion: 4,
  reviews_pending: 4,
  unanswered_messages: 4,
  gear_overdue: 4,
  gear_due_back: 4,
  gear_service_due: 4,
  work_order_late: 4,
  work_order_uncollected: 4,
  staff_credential_due: 4,
  units_unconfirmed: 4,
  lost_items_waiting: 4,
};

export function boatTier(action: TodayAction): number {
  if (rowTone(action) === "danger") return 0;
  if (action.diver?.readiness === true) return 0;
  return BOAT_TIER[action.kind] ?? 0;
}

export function rankBoatRows(rows: readonly TodayAction[]): TodayAction[] {
  return rows
    .map((row, index) => ({ row, index, tier: boatTier(row) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * **A Needs you row's line ends without a period** (visual review
 * 2026-10-24, A22): "{person} · {one-line why}" reads as a label, and a
 * label takes no full stop. The readers in `src/lib/today.ts` and `src/db`
 * compose the same words as sentences for the other places they are said
 * (the week's rows, the trip page), so the row drops the one final period at
 * render time. A line of two sentences keeps its punctuation: dropping the
 * last stop of "X. Do Y." would leave half a sentence ended and half not.
 */
export function rowLine(text: string): string {
  if (!text.endsWith(".") || text.endsWith("..")) return text;
  const body = text.slice(0, -1);
  return /[.?!]\s/.test(body) ? text : body;
}
