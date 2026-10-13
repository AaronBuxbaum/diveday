import type { EveningClose } from "@/lib/closeout";
import type { DaySpine, DayStation } from "@/lib/today";

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
