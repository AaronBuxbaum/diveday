import type { requireShopSurface } from "@/features/session";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ExecutedDiveLog } from "../manifest/_components/ExecutedDiveLog";
import { executedDiveLogView } from "../manifest/_components/executed-dive-copy";
import { manifestSpecies } from "../manifest/_components/manifest-species";
import { readManifestView } from "../manifest/_components/manifest-view";
import { saveExecutedDiveAction } from "../manifest/actions";

/** Dive records keep the existing per-dive authorization and validation. */
export async function TripDiveRecord({
  context,
  tripId,
  locale,
  t,
}: {
  context: Pick<Awaited<ReturnType<typeof requireShopSurface>>, "db" | "shop" | "session">;
  tripId: string;
  locale: string;
  t: StaffTranslator;
}) {
  const { shop } = context;
  const view = await readManifestView({ ...context, shopSlug: shop.slug, tripId, locale, t });
  if (view.status !== "ready") return null;
  const { catalogSpecies, speciesBySite } = manifestSpecies(locale, view.fieldGuides);
  const log = executedDiveLogView({
    plannedDives: view.plannedDives,
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
    <div className="space-y-6">
      {view.completeManifests
        .filter((manifest) => manifest.checkpoint !== "departure")
        .map((manifest) => (
          <ExecutedDiveLog
            key={manifest.checkpoint}
            {...log}
            idPrefix={`trip-record-${manifest.checkpoint}`}
            checkpoint={manifest.checkpoint}
            action={saveExecutedDiveAction.bind(null, {
              shopSlug: shop.slug,
              tripId,
              checkpoint: manifest.checkpoint,
            })}
            sightingsOn={shop.sightingsEnabled}
          />
        ))}
    </div>
  );
}
