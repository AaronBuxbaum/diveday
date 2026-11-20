import type { ReadyManifestView } from "../TripDiveRecord";
import { type DiveNotMade, type WaterStanding, waterStanding } from "../water-standing";

/**
 * The roll call's own reading, as `waterStanding` takes it: every count, the
 * open missing-diver alerts, the plan and what was logged, the crew's latest
 * word and the boat check. Shared by On the water and Wrapped up.
 */
export function waterStandingOf(
  view: ReadyManifestView,
  /** Planned dives the crew recorded not made (`diveNotMadeStanding`), for Wrapped up. */
  notMade?: ReadonlyMap<number, DiveNotMade>,
): WaterStanding {
  const stage = view.stageStrip.stage;
  const items = view.checklistProps.items;
  return waterStanding({
    counts: view.completeManifests,
    alerted: view.reader.alerted,
    openAlerts: view.reader.openAlerts,
    plannedDives: view.plannedDives.map(({ dive, diveSite }) => ({
      diveNumber: dive.diveNumber,
      site: diveSite?.name ?? null,
    })),
    logged: new Map(
      view.executedDives.map(({ executed }) => [
        executed.diveNumber,
        {
          enteredAt: executed.enteredAt,
          exitedAt: executed.exitedAt,
          maxDepthMeters: executed.notRecorded.includes("depth") ? null : executed.maxDepthMeters,
        },
      ]),
    ),
    stage: stage ? { stage: stage.stage, recordedAt: stage.recordedAt } : null,
    homeSaidAt: stage?.stage === "home" ? stage.recordedAt : null,
    endsAt: view.departureManifest.trip.endsAt,
    boatChecks: {
      checked: items.filter((item) => item.checkedByLine !== undefined).length,
      total: items.length,
    },
    notMade,
  });
}

/**
 * The dives whose log is offered. Once the boat is back, every dive. On the
 * water, each dive whose count has begun or that is logged, and the next one,
 * the dive the boat is on now: a crew may log it before counting, never a dive
 * further ahead.
 */
export function loggableDives(standing: WaterStanding, { back }: { back: boolean }): number[] {
  const dives = standing.timeline.flatMap((stop) => (stop.kind === "dive" ? [stop] : []));
  if (back) return dives.map((stop) => stop.dive);
  const next = dives.find((stop) => stop.state === "ahead" && !stop.logged);
  return dives
    .filter((stop) => stop.state !== "ahead" || stop.logged || stop === next)
    .map((stop) => stop.dive);
}
