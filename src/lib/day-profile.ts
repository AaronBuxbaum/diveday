import {
  betweenDivesMinutes,
  type DiveMode,
  type DockDayRhythm,
  type LegTravelTimes,
  plannedBottomTimeMinutes,
} from "./diver-planning";

/**
 * **The shape of the day, before anybody has booked a seat.**
 *
 * The departure page already lists the run of dives (`TripDayPlan`). What it
 * could not say was the two figures a diver actually plans around: how long
 * each dive is meant to run, and how long they are out of the water between
 * them. Both are already on file — `shops.bottom_time_minutes` and
 * `shops.surface_interval_minutes`, a site's own
 * `dive_sites.expected_bottom_time_minutes`, a departure's own
 * `trip_dives.travel_minutes` — and neither reached a diver deciding whether
 * the day was theirs, because the one surface that laid them out (the dock-day
 * rhythm) moved to the diver's own thread after booking.
 *
 * **Everything here is planned, never observed.** DiveDay records nothing about
 * dives performed (glossary, **Dive record**), and the glossary's **Surface
 * interval** is the measured gap between two *executed* dives. This is the
 * shop's published rhythm laid over this departure's dives, so every surface
 * that renders it says "usually" or "about" in its own words. The domain layer
 * returns the numbers; the bundle picks the sentence (AGENTS.md).
 *
 * The arithmetic is not a second copy of the timeline's. `betweenDivesMinutes`
 * and `plannedBottomTimeMinutes` are `dockDayOffsets`' own helpers, so a diver
 * reading "about an hour on the surface" here and the beats on their thread
 * after booking is reading one calculation twice.
 */

/** One planned dive of a departure, as the day profile needs it. */
export type PlannedDive = {
  /** `trip_dives.dive_number`; the rows may arrive in any order. */
  number: number;
  /**
   * The **site's** deepest point in stored metres, or null when the shop has
   * not said (or the dive names no site yet). Never this dive's own plan —
   * `dive_sites.max_depth_meters` is a fact about the place (glossary, **Site
   * maximum depth**), which is exactly what the certification ceiling is
   * compared against.
   */
  siteMaxDepthMeters: number | null;
  /** The site's own `expected_bottom_time_minutes`, when it overrides the shop's. */
  siteBottomTimeMinutes?: number | null;
  /** This leg's `trip_dives.travel_minutes`, when the departure states one. */
  travelMinutes?: number | null;
};

export type DayProfileRow =
  | {
      kind: "dive";
      number: number;
      siteMaxDepthMeters: number | null;
      /** Minutes in the water, or null when the shop's rhythm states none. */
      bottomTimeMinutes: number | null;
    }
  | {
      kind: "surfaceInterval";
      /** The dive this gap follows, so a caller can key the row stably. */
      afterDiveNumber: number;
      minutes: number;
    };

export type DayProfileInput = {
  dives: readonly PlannedDive[];
  /** The shop's own rhythm — the fallback for every figure a dive does not state. */
  rhythm: DockDayRhythm;
  /** How divers get wet. Off a boat there is no run between sites to widen the gap. */
  diveMode?: DiveMode;
  /**
   * How many days this departure meets on (`trip_schedule_days`). Dives are
   * dealt across them the way the dock-day rhythm deals them — the first days
   * take the remainder — and **no interval crosses a day boundary**: the gap
   * between the last dive of Saturday and the first of Sunday is a night, not a
   * surface interval, and saying "about an hour on the surface" there would be
   * false in the one direction this figure must never err (glossary).
   */
  dayCount?: number;
};

/**
 * The day as a run of dives with the gaps between them, in plan order.
 *
 * Silent where it has nothing true to say: one dive has no gap after it, a
 * shop that dives back to back (`surface_interval_minutes` 0) on a shore day
 * gets no interval row at all, and a rhythm with no bottom time leaves the
 * figure null rather than printing a zero.
 */
export function dayProfileRows({
  dives,
  rhythm,
  diveMode = "boat",
  dayCount = 1,
}: DayProfileInput): DayProfileRow[] {
  // Sorted here rather than trusted from the caller: `listTripDives` orders by
  // dive number, but a caller assembling briefings from two queries need not,
  // and a day profile read out of order would state the wrong gap after the
  // wrong dive.
  const ordered = [...dives].sort((a, b) => a.number - b.number);
  const days = Math.max(1, Math.trunc(dayCount));
  // The dock-day rhythm's own split: base dives each day, remainder to the
  // front. `lastOfDay` holds the index each day ends on, so the loop below can
  // ask "does this dive close a day?" without re-deriving the split.
  const base = Math.floor(ordered.length / days);
  const remainder = ordered.length % days;
  const lastOfDay = new Set<number>();
  let index = 0;
  for (let day = 0; day < days && index < ordered.length; day++) {
    index += base + (day < remainder ? 1 : 0);
    if (index > 0) lastOfDay.add(index - 1);
  }

  // Each dive's own leg, in plan order, so `betweenDivesMinutes` reads the same
  // shape it reads on the dock-day timeline. A leg belongs to the dive it
  // delivers to, so the gap after position `p` is leg `p + 2` (1-based).
  const legTravelTimes: LegTravelTimes = ordered.map((dive) => dive.travelMinutes);

  const rows: DayProfileRow[] = [];
  ordered.forEach((dive, position) => {
    const minutes = plannedBottomTimeMinutes(rhythm.bottomTimeMinutes, dive.siteBottomTimeMinutes);
    rows.push({
      kind: "dive",
      number: dive.number,
      siteMaxDepthMeters: dive.siteMaxDepthMeters,
      bottomTimeMinutes: minutes > 0 ? minutes : null,
    });
    if (position === ordered.length - 1 || lastOfDay.has(position)) return;
    const gap = betweenDivesMinutes(rhythm, legTravelTimes, position + 2, diveMode);
    if (gap.minutes > 0) {
      rows.push({ kind: "surfaceInterval", afterDiveNumber: dive.number, minutes: gap.minutes });
    }
  });
  return rows;
}

/** Whether a day profile states a figure worth rendering at all. */
export function dayProfileHasFacts(rows: readonly DayProfileRow[]): boolean {
  return rows.some((row) =>
    row.kind === "dive" ? row.bottomTimeMinutes !== null : row.minutes > 0,
  );
}
