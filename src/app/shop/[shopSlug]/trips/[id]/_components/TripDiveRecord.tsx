import type { StaffTranslator } from "@/i18n/staff-messages";
import { scopedHash } from "@/lib/element-id";
import { ExecutedDiveLog } from "../manifest/_components/ExecutedDiveLog";
import { executedDiveLogView } from "../manifest/_components/executed-dive-copy";
import { manifestSpecies } from "../manifest/_components/manifest-species";
import type { readManifestView } from "../manifest/_components/manifest-view";
import { saveExecutedDiveAction } from "../manifest/actions";

export type ReadyManifestView = Extract<
  Awaited<ReturnType<typeof readManifestView>>,
  { status: "ready" }
>;

const prefix = (dive: number) => `dive-log-${dive}`;

/** Where dive `dive`'s log form is on the page, for "Log this dive". */
export function diveLogHash(dive: number): string {
  return scopedHash(prefix(dive), "executed-dive");
}

/**
 * **Each dive's log, in the one place it is written** (ADR
 * 20261117-trip-page-clock): the Trip page, On the water and Wrapped up. Keeps
 * the existing per-dive authorization and validation (`saveExecutedDiveAction`).
 */
export function TripDiveRecord({
  view,
  dives,
  shop,
  tripId,
  locale,
  t,
}: {
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
}) {
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, view.fieldGuides);
  const afterDives = view.completeManifests.filter(
    (manifest) =>
      manifest.checkpoint !== "departure" &&
      dives.includes(Number(manifest.checkpoint.slice("after_dive_".length))),
  );
  if (afterDives.length === 0) return null;
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
  return (
    <section aria-labelledby="dive-record-heading" className="space-y-4">
      <h2 id="dive-record-heading" className="font-semibold">
        {log.labels.heading}
      </h2>
      {afterDives.map((manifest) => (
        <ExecutedDiveLog
          key={manifest.checkpoint}
          {...log}
          headed={false}
          idPrefix={prefix(Number(manifest.checkpoint.slice("after_dive_".length)))}
          checkpoint={manifest.checkpoint}
          action={saveExecutedDiveAction.bind(null, {
            shopSlug: shop.slug,
            tripId,
            checkpoint: manifest.checkpoint,
          })}
          sightingsOn={shop.sightingsEnabled}
        />
      ))}
    </section>
  );
}
