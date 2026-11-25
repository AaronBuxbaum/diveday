import type { ReactNode } from "react";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { DAY_MS } from "@/lib/clock";
import { scopedHash } from "@/lib/element-id";
import { utcToWallTime } from "@/lib/zoned";
import { ExecutedDiveLog } from "../manifest/_components/ExecutedDiveLog";
import { executedDiveLogView } from "../manifest/_components/executed-dive-copy";
import { manifestSpecies } from "../manifest/_components/manifest-species";
import type { readManifestView } from "../manifest/_components/manifest-view";
import { saveExecutedDiveAction } from "../manifest/actions";
import { TripCard } from "./trip-ink";

export type ReadyManifestView = Extract<
  Awaited<ReturnType<typeof readManifestView>>,
  { status: "ready" }
>;

const prefix = (dive: number) => `dive-log-${dive}`;

/** Where dive `dive`'s log form is on the page, for "Log this dive". */
export function diveLogHash(dive: number): string {
  return scopedHash(prefix(dive), "executed-dive");
}

type LogInput = {
  view: ReadyManifestView;
  /** The dives to offer: each one whose count has begun, or that is logged. */
  dives: readonly number[];
  shop: {
    slug: string;
    timezone: string;
    depthUnit: Parameters<typeof executedDiveLogView>[0]["depthUnit"];
    sightingsEnabled: boolean;
  };
  tripId: string;
  locale: string;
  t: StaffTranslator;
};

/**
 * Each offered dive's log form, keyed by dive, drawn by `draw` with an
 * optional row to stand in for its collapsed line. Keeps the existing per-dive
 * authorization and validation (`saveExecutedDiveAction`).
 */
function diveLogs({ view, dives, shop, tripId, locale, t }: LogInput) {
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, view.fieldGuides);
  const afterDives = view.completeManifests.filter(
    (manifest) =>
      manifest.checkpoint !== "departure" &&
      dives.includes(Number(manifest.checkpoint.slice("after_dive_".length))),
  );
  const log = executedDiveLogView({
    plannedDives: view.plannedDives,
    diveCount: view.completeManifests.length - 1,
    executedDives: view.executedDives,
    liveDiveSites: view.liveDiveSites,
    catalogSpecies,
    speciesBySite,
    locale,
    timeZone: shop.timezone,
    depthUnit: shop.depthUnit,
    t,
  });
  return {
    heading: log.labels.heading,
    summaryOf: (dive: number) =>
      log.planned.find((planned) => planned.diveNumber === dive)?.summaryLine ?? null,
    numbers: afterDives.map((manifest) => Number(manifest.checkpoint.slice("after_dive_".length))),
    draw: (dive: number, row?: ReactNode) => {
      const manifest = afterDives.find((m) => m.checkpoint === `after_dive_${dive}`);
      if (!manifest) return null;
      return (
        <ExecutedDiveLog
          key={manifest.checkpoint}
          {...log}
          headed={false}
          row={row}
          idPrefix={prefix(dive)}
          tripDate={calendarDateInTimezone(view.departureManifest.trip.startsAt, shop.timezone)}
          tripStartTime={(() => {
            const wall = utcToWallTime(view.departureManifest.trip.startsAt, shop.timezone);
            return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
          })()}
          multiDay={
            view.departureManifest.trip.endsAt.getTime() -
              view.departureManifest.trip.startsAt.getTime() >
            DAY_MS
          }
          checkpoint={manifest.checkpoint}
          action={saveExecutedDiveAction.bind(null, {
            shopSlug: shop.slug,
            tripId,
            checkpoint: manifest.checkpoint,
          })}
          sightingsOn={shop.sightingsEnabled}
        />
      );
    },
  };
}

/**
 * **Each dive's row opens in place to its log** (Wrapped up's What happened):
 * a function from a dive and the row that says what happened on it to that
 * row, opening to the log form; null for a dive with no count begun.
 */
export function diveLogRows(input: LogInput): (dive: number, row: ReactNode) => ReactNode {
  const logs = diveLogs(input);
  return (dive, row) => logs.draw(dive, row);
}

/**
 * **Each dive's log, in the one place it is written** (ADR
 * 20261117-trip-page-clock): On the water, one card under its own heading,
 * each dive a row opening in place to its form.
 */
export function TripDiveRecord(input: LogInput) {
  const logs = diveLogs(input);
  if (logs.numbers.length === 0) return null;
  return (
    <TripCard heading={logs.heading} headingId="dive-record-heading">
      <div className="divide-y divide-border">
        {logs.numbers.map((dive) =>
          logs.draw(dive, <span className="font-semibold">{logs.summaryOf(dive)}</span>),
        )}
      </div>
    </TripCard>
  );
}
