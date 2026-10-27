import { SavedPrintDetails } from "@/components/editor/SavedPrintDetails";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { TideStationEcho } from "@/lib/tide-stations";
import type { FieldGuideCatalogEntry } from "./FieldGuideEditor";
import type { SiteFieldValues } from "./SiteFields";
import { siteFormSectionLabels } from "./site-form-sections";
import { savedFitLines, savedForecastLines } from "./site-saved-paper-facts";

/** Only stored briefing facts; no private diver information or editor drafts. */
export function SiteSavedPrintDetails({
  values,
  t,
  catalog,
  fieldGuideOn,
  tideStation,
  depthUnit,
}: {
  values: SiteFieldValues;
  t: StaffTranslator;
  catalog: readonly FieldGuideCatalogEntry[];
  fieldGuideOn: boolean;
  tideStation?: TideStationEcho | null;
  depthUnit: DepthUnit;
}) {
  const labels = siteFormSectionLabels(t);
  const names = new Map(catalog.map((creature) => [creature.slug, creature.name]));
  return (
    <SavedPrintDetails
      title={t("shared.formDraft.savedDetails")}
      sections={[
        {
          title: labels.forecast,
          lines: savedForecastLines(values, tideStation, depthUnit, t),
        },
        {
          title: labels.route,
          lines: [values.routeLabel, values.routeNote],
        },
        { title: labels.underwater, lines: [values.marineLife, values.marineLifeDescription] },
        { title: labels.planning, lines: [values.planningNote] },
        { title: labels.fit, lines: savedFitLines(values, t) },
        {
          title: labels.landmarks,
          lines: values.landmarks.map((landmark) =>
            [landmark.name, landmark.note].filter(Boolean).join(" · "),
          ),
        },
        {
          title: labels.fieldGuide,
          lines: fieldGuideOn
            ? [values.fieldGuideTipsHeading, ...values.creatures.map((slug) => names.get(slug))]
            : [],
        },
      ]}
    />
  );
}
