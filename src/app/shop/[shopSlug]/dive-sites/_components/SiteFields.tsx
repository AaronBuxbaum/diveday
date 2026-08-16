import { ImageFileInput } from "@/components/ImageFileInput";
import { StoredPhoto } from "@/components/StoredPhoto";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiveSiteFitTone, DiveSpecialty } from "@/db/schema";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import { DIVE_SITE_DIFFICULTIES, type DiveSiteDifficulty } from "@/lib/dive-site-difficulty";

import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import { DEFAULT_ROUTE_ZOOM, type RoutePoint } from "@/lib/dive-site-route";
import { MAX_SITE_IMAGES } from "@/lib/dive-sites";
import { DOCK_DAY_LIMITS } from "@/lib/diver-planning";
import type { CertificationLevel } from "@/lib/readiness";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import {
  type FieldGuideCatalogEntry,
  FieldGuideEditor,
  type FieldGuideEditorCopy,
} from "./FieldGuideEditor";
import { LandmarkEditor, type LandmarkEditorCopy } from "./LandmarkEditor";
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
  difficultyLevel: DiveSiteDifficulty | null;
  depthRange: string | null;
  maxDepthMeters: number | null;
  expectedBottomTimeMinutes: number | null;
  currentNote: string | null;
  divePlan: string | null;
  fitTone: DiveSiteFitTone | null;
  fitNote: string | null;
  fieldGuideTipsHeading: string | null;
  landmarks: DiveSiteLandmark[];
  /** The catalog slugs this site's field guide shows, in order. */
  creatures: string[];
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
};

/**
 * One photo the site already holds, with the box that takes it back off.
 *
 * The whole cell is a `<label>` wrapping its own checkbox, so a tap on the
 * photo toggles *that* photo rather than the first one — the same shape the
 * course editor's gallery uses.
 */
function ExistingPhoto({
  url,
  removeName,
  removeValue = "true",
  removeLabel,
}: {
  url: string;
  removeName: string;
  /** The gallery posts the photo's own URL; a single-photo field posts "true". */
  removeValue?: string;
  removeLabel: string;
}) {
  return (
    <label className="block cursor-pointer">
      <input type="checkbox" name={removeName} value={removeValue} className="peer sr-only" />
      <StoredPhoto
        src={url}
        alt=""
        className="h-24 w-full rounded-lg border-2 border-border transition peer-checked:border-danger peer-checked:opacity-50"
        sizes="(min-width: 640px) 25vw, 50vw"
      />
      <span className="mt-1 block text-xs font-medium text-muted transition peer-checked:text-danger">
        {removeLabel}
      </span>
    </label>
  );
}

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
  landmarkCopy,
  fieldGuideCopy,
  marineLifeCatalog,
  siteId,
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
  /** Same for the landmark and field-guide editors, which are Client Components too. */
  landmarkCopy: LandmarkEditorCopy;
  fieldGuideCopy: FieldGuideEditorCopy;
  /** DiveDay's species catalog, as the field-guide picker's autocomplete source. */
  marineLifeCatalog: FieldGuideCatalogEntry[];
  /** The site being edited, so a species request carries what they were writing. */
  siteId?: string | null;
}) {
  // `ImageFileInput` is a Client Component, so its words arrive resolved.
  const imageInputCopy = {
    wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
    tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
  };
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
              required
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
              required
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
      {/* Photos arrive as files now, never as pasted links. The old three
          boxes took a URL and the server had to fetch and re-store each one,
          because a public briefing page must never make a live request to a
          host a staffer chose (CR-020) — an upload removes the fetch and the
          whole class of problem with it. */}
      <fieldset className="rounded-2xl border border-border p-4 sm:p-5">
        <legend className="px-1 text-sm font-medium">{t("diveSites.form.photosLegend")}</legend>
        <p className="mt-1 text-sm text-muted">{t("diveSites.form.photosDescription")}</p>
        {/* Each stored photo sits *under* its own `Field`, never inside it. A
            `Field` whose children are not one native control wraps everything
            in the caption `<label>` (see `src/components/ui/form.tsx`), and
            each remove box is a `<label>` of its own — nesting the two would
            be invalid markup and would hand the caption a name made of every
            word in the block. Under rather than over, because a photo above
            its own caption reads as belonging to whatever field precedes it:
            the first visual-regression run of this form showed the gallery
            hanging off the map/route row it merely happened to sit below. */}
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <div>
            <Field
              label={t("diveSites.form.mapImageLabel")}
              hint={t("diveSites.form.optionalHint")}
            >
              <ImageFileInput name="satelliteImageFile" copy={imageInputCopy} />
            </Field>
            {values?.satelliteImageUrl ? (
              <div className="mt-2">
                <ExistingPhoto
                  url={values.satelliteImageUrl}
                  removeName="removeSatelliteImage"
                  removeLabel={t("diveSites.form.removeCurrentPhoto")}
                />
              </div>
            ) : null}
          </div>
          <div>
            <Field
              label={t("diveSites.form.routeImageLabel")}
              hint={t("diveSites.form.optionalHint")}
            >
              <ImageFileInput name="routeImageFile" copy={imageInputCopy} />
            </Field>
            {values?.routeImageUrl ? (
              <div className="mt-2">
                <ExistingPhoto
                  url={values.routeImageUrl}
                  removeName="removeRouteImage"
                  removeLabel={t("diveSites.form.removeCurrentPhoto")}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5">
          <Field
            label={t("diveSites.form.sitePhotosLabel")}
            hint={t("diveSites.form.sitePhotosHint", { max: MAX_SITE_IMAGES })}
          >
            <ImageFileInput
              name="siteImageFiles"
              multiple
              maxFiles={MAX_SITE_IMAGES}
              copy={{
                ...imageInputCopy,
                tooMany: t("diveSites.form.tooManyPhotos", { max: MAX_SITE_IMAGES }),
              }}
            />
          </Field>
          {values && values.imageUrls.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {values.imageUrls.map((url) => (
                <ExistingPhoto
                  key={url}
                  url={url}
                  removeName="removeSiteImageUrls"
                  removeValue={url}
                  removeLabel={t("diveSites.form.removeLabel")}
                />
              ))}
            </div>
          ) : null}
        </div>
      </fieldset>
      <FieldGrid columns={1} className="gap-y-5">
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
          {/* A picker, not a text box: the word ends up on a diver's briefing
              and has to arrive in their language, so it is a code with a
              translated label (ADR 20260813-marine-life-is-diveday-copy applies
              the same reasoning to species). Every value any shop had typed
              here was already one of these three. */}
          <select
            name="difficulty"
            defaultValue={values?.difficultyLevel ?? ""}
            className={controlClass}
          >
            <option value="">{t("diveSites.form.difficultyUnset")}</option>
            {DIVE_SITE_DIFFICULTIES.map((level) => (
              <option key={level} value={level}>
                {t(`diveSites.form.difficultyLevels.${level}`)}
              </option>
            ))}
          </select>
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
        {/* Minutes, in nobody's unit but its own — so it sits beside the depth
            rather than being folded into the shop-wide rhythm in Settings. A
            wall run at 30 minutes and a shallow reef run at 60 are both real,
            and one shop-wide number told a diver the wrong one on whichever it
            was not. Blank leaves the shop's own figure standing. */}
        <Field
          label={t("diveSites.form.expectedBottomTimeLabel")}
          hint={t("diveSites.form.expectedBottomTimeHint")}
        >
          <input
            name="expectedBottomTime"
            type="number"
            inputMode="numeric"
            min={DOCK_DAY_LIMITS.bottomTimeMinutes.min}
            max={DOCK_DAY_LIMITS.bottomTimeMinutes.max}
            step={1}
            defaultValue={values?.expectedBottomTimeMinutes ?? ""}
            placeholder={t("diveSites.form.expectedBottomTimePlaceholder")}
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
      </FieldGrid>
      {/* Who this site suits, in the shop's own words. The label above it is a
          translated status word the shop picks; the sentence under it is
          whatever the shop wants to say instead of DiveDay's canned line. Left
          on "work it out", the label is still read off the facts above — which
          is what every site did before this fieldset existed. */}
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">{t("diveSites.form.fitLegend")}</legend>
        <p className="mt-1 text-sm text-muted">{t("diveSites.form.fitDescription")}</p>
        <FieldGrid columns={1} className="mt-4 gap-y-5">
          <Field label={t("diveSites.form.fitToneLabel")}>
            <select name="fitTone" defaultValue={values?.fitTone ?? ""} className={controlClass}>
              <option value="">{t("diveSites.form.fitToneDerive")}</option>
              <option value="welcoming">{t("diveSites.form.fitToneWelcoming")}</option>
              <option value="demanding">{t("diveSites.form.fitToneDemanding")}</option>
              <option value="unknown">{t("diveSites.form.fitToneAskCrew")}</option>
            </select>
          </Field>
          <Field label={t("diveSites.form.fitNoteLabel")} hint={t("diveSites.form.optionalHint")}>
            <textarea
              name="fitNote"
              rows={2}
              maxLength={400}
              defaultValue={values?.fitNote ?? ""}
              placeholder={t("diveSites.form.fitNotePlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
      </fieldset>
      <LandmarkEditor initialLandmarks={values?.landmarks ?? []} copy={landmarkCopy} />
      <FieldGuideEditor
        initialSlugs={values?.creatures ?? []}
        catalog={marineLifeCatalog}
        copy={fieldGuideCopy}
        siteId={siteId}
      />
      <FieldGrid columns={1} className="gap-y-5">
        <Field
          label={t("diveSites.form.tipsHeadingLabel")}
          hint={t("diveSites.form.tipsHeadingHint")}
        >
          <input
            name="fieldGuideTipsHeading"
            maxLength={80}
            defaultValue={values?.fieldGuideTipsHeading ?? ""}
            placeholder={t("diveSites.form.tipsHeadingPlaceholder")}
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
