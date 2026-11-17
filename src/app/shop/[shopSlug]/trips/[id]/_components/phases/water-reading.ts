import type { ReadyManifestView } from "../TripDiveRecord";
import { type WaterStanding, waterStanding } from "../water-standing";

/**
 * The roll call's own reading, as `waterStanding` takes it: every count, the
 * open missing-diver alerts, the plan and what was logged, the crew's latest
 * word and the boat check. Shared by On the water and Wrapped up.
 */
export function waterStandingOf(view: ReadyManifestView): WaterStanding {
  const stage = view.stageStrip.stage;
  const items = view.checklistProps.items;
  return waterStanding({
    counts: view.completeManifests,
    alerted: view.reader.alerted,
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
  });
}
