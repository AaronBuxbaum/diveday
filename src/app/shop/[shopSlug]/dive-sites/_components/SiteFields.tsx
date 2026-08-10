import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiveSpecialty } from "@/db/schema";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import { DEFAULT_ROUTE_ZOOM, type RoutePoint } from "@/lib/dive-site-route";
import type { CertificationLevel } from "@/lib/readiness";
import { RouteEditor, type RouteEditorCopy } from "./RouteEditor";

/**
 * The subset of a stored dive site the form needs to prefill. `undefined`
 * (the new-site page) means every field renders blank; a site row (the edit
 * page) prefills each `defaultValue`.
 */
export type SiteFieldValues = {
  name: string;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  locationName: string | null;
  description: string | null;
  satelliteImageUrl: string | null;
  routeImageUrl: string | null;
  routePoints: RoutePoint[];
  routeLabel: string | null;
  routeNote: string | null;
  routeZoom: number;
  imageUrls: string[];
  marineLife: string | null;
  marineLifeDescription: string | null;
  difficulty: string | null;
  depthRange: string | null;
  maxDepthMeters: number | null;
  currentNote: string | null;
  divePlan: string | null;
  landmarks: string[];
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
};

/**
 * The 19-field dive-site briefing, shared between the blank `new/` form and
 * the prefilled `[id]/` edit form — the only difference between the two pages
 * was every field repeated with (or without) a `defaultValue`. Rendered on the
 * server (staff copy is server-side) and handed to `SiteFormShell` as
 * children, so a refused submit re-renders nothing here and every value the
 * staffer typed survives.
 */
export function SiteFields({
  t,
  depthUnit,
  values,
  certificationDescription,
  requiredSpecialtiesLabel,
  routeCopy,
}: {
  t: StaffTranslator;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
  /** Omitted for a blank briefing; a site row prefills every field. */
  values?: SiteFieldValues;
  /** The certification fieldset's page-specific lead-in sentence. */
  certificationDescription: string;
  /** Edit-only heading above the specialty checkboxes; the new form has none. */
  requiredSpecialtiesLabel?: string;
  /** Every word the route editor renders, resolved here (it is a Client Component). */
  routeCopy: RouteEditorCopy;
}) {
  return (
    <>
      <FieldGrid columns={1}>
        <Field label={t("diveSites.form.nameLabel")}>
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={values?.name}
            placeholder={values ? undefined : t("diveSites.form.namePlaceholder")}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">{t("diveSites.form.forecastLegend")}</legend>
        <p className="mt-1 text-sm text-muted">{t("diveSites.form.forecastDescription")}</p>
        <FieldGrid columns={2} className="mt-4 gap-y-5">
          <Field label={t("diveSites.form.latitudeLabel")}>
            <input
              name="forecastLatitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={values?.forecastLatitude ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("diveSites.form.longitudeLabel")}>
            <input
              name="forecastLongitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={values?.forecastLongitude ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
      </fieldset>
      {/* Directly under the coordinates it depends on: the route is drawn as
          percentages of the frame those two fields centre, and the editor
          watches them as they are typed. */}
      <RouteEditor
        initialPoints={values?.routePoints ?? []}
        initialLabel={values?.routeLabel ?? ""}
        initialNote={values?.routeNote ?? ""}
        initialZoom={values?.routeZoom ?? DEFAULT_ROUTE_ZOOM}
        latitude={values?.forecastLatitude ?? null}
        longitude={values?.forecastLongitude ?? null}
        copy={routeCopy}
      />
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={t("diveSites.form.locationLabel")} hint={t("diveSites.form.optionalHint")}>
          <input
            name="locationName"
            maxLength={160}
            defaultValue={values?.locationName ?? ""}
            placeholder={values ? undefined : t("diveSites.form.locationPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.descriptionLabel")}>
          <textarea
            name="description"
            rows={3}
            maxLength={1200}
            defaultValue={values?.description ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("diveSites.form.satelliteImageLabel")}>
          <textarea
            name="satelliteImageUrl"
            rows={2}
            defaultValue={values?.satelliteImageUrl ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.routeImageLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="routeImageUrl"
            rows={2}
            defaultValue={values?.routeImageUrl ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={1} className="gap-y-5">
        <Field
          label={t("diveSites.form.sitePhotosLabel")}
          hint={t("diveSites.form.sitePhotosHint")}
        >
          <textarea
            name="imageUrls"
            rows={4}
            defaultValue={values?.imageUrls.join("\n") ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.marineLifeLabel")}>
          <input
            name="marineLife"
            maxLength={400}
            defaultValue={values?.marineLife ?? ""}
            placeholder={values ? undefined : t("diveSites.form.marineLifePlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.briefingLabel")}>
          <textarea
            name="marineLifeDescription"
            rows={3}
            maxLength={1200}
            defaultValue={values?.marineLifeDescription ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("diveSites.form.difficultyLabel")} hint={t("diveSites.form.optionalHint")}>
          <input
            name="difficulty"
            maxLength={120}
            defaultValue={values?.difficulty ?? ""}
            placeholder={t("diveSites.form.difficultyPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.depthRangeLabel")} hint={t("diveSites.form.optionalHint")}>
          <input
            name="depthRange"
            maxLength={120}
            defaultValue={values?.depthRange ?? ""}
            placeholder={t("diveSites.form.depthRangePlaceholder")}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={2} className="gap-y-5">
        {/* The one depth figure a certification ceiling can be compared against
            (H-08). Left blank it simply never warns — this advises, it never gates. */}
        <Field
          label={t(
            depthUnit === "feet"
              ? "diveSites.form.maxDepthFeetLabel"
              : "diveSites.form.maxDepthMetersLabel",
          )}
          hint={t("diveSites.form.maxDepthHint")}
        >
          <input
            name="maxDepth"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxEnteredDepth(depthUnit)}
            step={1}
            defaultValue={
              values?.maxDepthMeters == null ? "" : depthInUnit(values.maxDepthMeters, depthUnit)
            }
            placeholder={depthUnit === "feet" ? "60" : "18"}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={t("diveSites.form.currentNoteLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="currentNote"
            rows={2}
            maxLength={500}
            defaultValue={values?.currentNote ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.divePlanLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="divePlan"
            rows={3}
            maxLength={1200}
            defaultValue={values?.divePlan ?? ""}
            placeholder={t("diveSites.form.divePlanPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.landmarksLabel")} hint={t("diveSites.form.landmarksHint")}>
          <textarea
            name="landmarks"
            rows={3}
            maxLength={4000}
            defaultValue={values?.landmarks.join("\n") ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <fieldset className="rounded-2xl border border-border bg-surface-sunken p-5">
        <legend className="px-1 text-sm font-medium">
          {t("diveSites.form.certificationLegend")}
        </legend>
        <p className="text-sm text-muted">{certificationDescription}</p>
        <FieldGrid columns={1} className="mt-4">
          <Field label={t("diveSites.form.minimumCertificationLabel")}>
            <select
              name="minimumCertificationLevel"
              defaultValue={values?.minimumCertificationLevel ?? ""}
              className={controlClass}
            >
              <option value="">{t("diveSites.form.noLevelRequired")}</option>
              {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        {requiredSpecialtiesLabel ? (
          <p className="mt-4 text-sm font-medium">{requiredSpecialtiesLabel}</p>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                name="specialty"
                type="checkbox"
                value={value}
                defaultChecked={
                  values?.requiredSpecialties.includes(value as DiveSpecialty) ?? false
                }
                className="size-4 accent-primary"
              />
              {t(key)}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              name="requiresNitrox"
              type="checkbox"
              defaultChecked={values?.requiresNitrox ?? false}
              className="size-4 accent-primary"
            />
            {t("diveSites.form.nitroxCheckbox")}
          </label>
        </div>
      </fieldset>
    </>
  );
}
