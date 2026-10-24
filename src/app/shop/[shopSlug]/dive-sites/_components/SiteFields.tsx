import type { ReactNode } from "react";
import { RequirementFields } from "@/components/RequirementFields";
import { DisclosureRowList } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { DiveSiteFitTone, DiveSpecialty } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";

import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import { MAX_PLANNING_NOTE_LENGTH, planningNoteIsFresh } from "@/lib/dive-site-memory";
import { DEFAULT_ROUTE_ZOOM, type RoutePoint } from "@/lib/dive-site-route";
import { formatDateWithYear } from "@/lib/format";
import type { CertificationLevel } from "@/lib/readiness";
import type { TideStationEcho } from "@/lib/tide-stations";
import type { TidePreference } from "@/lib/tides";
import { ClosedEditorSection, OpenEditorSection } from "./EditorSections";
import {
  type FieldGuideCatalogEntry,
  FieldGuideEditor,
  type FieldGuideEditorCopy,
} from "./FieldGuideEditor";
import { LandmarkEditor, type LandmarkEditorCopy } from "./LandmarkEditor";
import { RouteEditor, type RouteEditorCopy } from "./RouteEditor";
import { SiteDiveFields } from "./SiteDiveFields";
import { SiteForecastFields } from "./SiteForecastFields";
import { SitePhotoFields } from "./SitePhotoFields";
import {
  SITE_FORM_OPEN_SECTIONS,
  SITE_FORM_SECTION_IDS,
  SITE_FORM_SPANISH_ID,
  type SiteFormSection,
  siteFormSectionLabels,
  siteFormSectionOrder,
} from "./site-form-sections";

/**
 * The subset of a stored dive site the form needs to prefill. `undefined`
 * (the new-site page) means every field renders blank; a site row (the edit
 * page) prefills each `defaultValue`.
 */
export type SiteFieldValues = {
  name: string;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  tideStationId: string | null;
  /** Whether the shop has already said it meant that station (issue #1731). */
  tideStationConfirmed: boolean;
  tidePreference: TidePreference;
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
  snorkelSuitable: boolean | null;
  depthRange: string | null;
  depthMinMeters: number | null;
  maxDepthMeters: number | null;
  expectedBottomTimeMinutes: number | null;
  currentNote: string | null;
  divePlan: string | null;
  conservationNote: string | null;
  fitTone: DiveSiteFitTone | null;
  fitNote: string | null;
  fieldGuideTipsHeading: string | null;
  landmarks: DiveSiteLandmark[];
  /** The catalog slugs this site's field guide shows, in order. */
  creatures: string[];
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
  /** The shop's own staff-only note about running this site (issue #1204). */
  planningNote: string | null;
  /** When it was written, so the editor can say whether it is still on the site list. */
  planningNoteAt: Date | null;
};

/** Which sections say something the fields cannot say for themselves. */
type SectionParts = {
  body: ReactNode;
  description?: ReactNode;
  /** A run of controls that genuinely is one group announces itself as one. */
  grouped?: boolean;
};

/**
 * The dive-site briefing, shared between the blank `new/` form and the
 * prefilled `[id]/` edit form — the only difference between the two pages was
 * every field repeated with (or without) a `defaultValue`. Rendered on the
 * server (staff copy is server-side) and handed to `SiteFormShell` as children,
 * so a refused submit re-renders nothing here and every value the staffer typed
 * survives.
 *
 * **Three sections open, the rest closed behind their names** (visual review
 * 2026-10-24, A11, after ADR 20260827-the-shops-shelves' long-form editor
 * pattern). The sections a briefing is edited for stand open on hairlines; the
 * others are one list of disclosures under them, each closed and named, so the
 * page is the length of what a staffer came to change. A closed section's
 * controls stay in the form and post with Save. The sentence beside Save names
 * a section out of `site-form-sections.ts`, and the `Record<SiteFormSection, …>`
 * below is what makes a section with no fields under it a compile error.
 *
 * Nothing here is DiveDay's words about the site itself: every sentence a diver
 * reads off a briefing comes off the row a shop wrote (ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words). The section names are
 * chrome on the shop's own editor, never copy that reaches a diver.
 */
export function SiteFields({
  t,
  depthUnit,
  values,
  tideStation,
  certificationDescription,
  requiredSpecialtiesLabel,
  routeCopy,
  landmarkCopy,
  fieldGuideCopy,
  marineLifeCatalog,
  siteId,
  locale,
  timezone,
  briefAssist,
  spanish,
  fieldGuideOn = true,
}: {
  t: StaffTranslator;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
  /** Omitted for a blank briefing; a site row prefills every field. */
  values?: SiteFieldValues;
  /**
   * What NOAA calls the station this site already carries, looked up in the
   * page's render (issue #1468). `null` or absent renders nothing at all —
   * a blank field, a station NOAA does not know, a lookup that timed out and
   * the new-site form are one case here, and the case is silence.
   */
  tideStation?: TideStationEcho | null;
  /** The certification section's page-specific lead-in sentence. */
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
  /** The reader's negotiated locale, for the planning note's own date. */
  locale: string;
  /** The shop's zone, so that date reads as the day the shop lived. */
  timezone: string;
  /** Claude's "Draft from these fields" (site-brief), inside this form; absent while dark. */
  briefAssist?: ReactNode;
  /** The briefing's Spanish boxes (edit only), closed behind a disclosure of their own. */
  spanish?: ReactNode;
  /** The shop's field-guide switch (the Features page); off, its section is not drawn. */
  fieldGuideOn?: boolean;
}) {
  const labels = siteFormSectionLabels(t);

  const sections: Record<SiteFormSection, SectionParts> = {
    about: {
      body: (
        <FieldGrid columns={1} className="gap-y-5">
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
              className={textareaClassFor(3)}
            />
            {briefAssist ? <div className="mt-2">{briefAssist}</div> : null}
          </Field>
        </FieldGrid>
      ),
    },

    forecast: {
      grouped: true,
      description: t("diveSites.form.forecastDescription"),
      body: (
        <SiteForecastFields t={t} depthUnit={depthUnit} values={values} tideStation={tideStation} />
      ),
    },

    // Directly under the coordinates it depends on: the route is drawn as
    // percentages of the frame those two fields centre, and the editor watches
    // them as they are typed.
    route: {
      grouped: true,
      description: t("diveSites.form.route.description"),
      body: (
        <RouteEditor
          initialPoints={values?.routePoints ?? []}
          initialLabel={values?.routeLabel ?? ""}
          initialNote={values?.routeNote ?? ""}
          initialZoom={values?.routeZoom ?? DEFAULT_ROUTE_ZOOM}
          latitude={values?.forecastLatitude ?? null}
          longitude={values?.forecastLongitude ?? null}
          copy={routeCopy}
        />
      ),
    },

    // Photos arrive as files now, never as pasted links. The old three boxes
    // took a URL and the server had to fetch and re-store each one, because a
    // public briefing page must never make a live request to a host a staffer
    // chose (CR-020) — an upload removes the fetch and the whole class of
    // problem with it.
    photos: {
      grouped: true,
      description: t("diveSites.form.photosDescription"),
      body: <SitePhotoFields t={t} values={values} />,
    },

    underwater: {
      body: (
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
              className={textareaClassFor(3)}
            />
          </Field>
        </FieldGrid>
      ),
    },

    dive: {
      body: <SiteDiveFields t={t} depthUnit={depthUnit} values={values} />,
    },

    // **What the shop wants to remember about running this site** (issue
    // #1204) — the one box on this form no diver ever reads. The line above it
    // exists only once there is a note: it says when it was written, and
    // whether it has dropped off the site list, which is the only thing about
    // the note the editor cannot show on its own.
    planning: {
      body: (
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("diveSites.form.planningNoteLabel")}
            description={t("diveSites.form.planningNoteDescription")}
            // The one thing the box cannot say for itself: when the note was
            // written, and whether it has dropped off the site list. Rendered
            // as the field's own hint rather than a paragraph wedged above the
            // control, so it keeps the form's one grammar.
            hint={
              values?.planningNote && values.planningNoteAt
                ? t(
                    planningNoteIsFresh(values.planningNoteAt)
                      ? "diveSites.planningNote.noted"
                      : "diveSites.planningNote.expired",
                    { date: formatDateWithYear(values.planningNoteAt, locale, timezone) },
                  )
                : undefined
            }
          >
            <textarea
              name="planningNote"
              rows={3}
              maxLength={MAX_PLANNING_NOTE_LENGTH}
              defaultValue={values?.planningNote ?? ""}
              placeholder={t("diveSites.form.planningNotePlaceholder")}
              className={textareaClassFor(3)}
            />
          </Field>
        </FieldGrid>
      ),
    },

    // Who this site suits, in the shop's own words. The label above it is a
    // translated status word the shop picks; the sentence under it is whatever
    // the shop wants to say instead of DiveDay's canned line. Left on "work it
    // out", the label is still read off the facts above.
    fit: {
      grouped: true,
      description: t("diveSites.form.fitDescription"),
      body: (
        <FieldGrid columns={1} className="gap-y-5">
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
              className={textareaClassFor(2)}
            />
          </Field>
        </FieldGrid>
      ),
    },

    landmarks: {
      grouped: true,
      description: t("diveSites.form.landmarks.description"),
      body: <LandmarkEditor initialLandmarks={values?.landmarks ?? []} copy={landmarkCopy} />,
    },

    fieldGuide: {
      grouped: true,
      description: t("diveSites.form.fieldGuide.description"),
      body: (
        <>
          <FieldGuideEditor
            initialSlugs={values?.creatures ?? []}
            catalog={marineLifeCatalog}
            copy={fieldGuideCopy}
            siteId={siteId}
          />
          <FieldGrid columns={1}>
            <Field
              label={t("diveSites.form.tipsHeadingLabel")}
              hint={t("diveSites.form.optionalHint")}
              description={t("diveSites.form.tipsHeadingHint")}
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
        </>
      ),
    },

    certification: {
      grouped: true,
      description: certificationDescription,
      body: (
        <RequirementFields
          t={t}
          requirement={values}
          defaultLevel=""
          labels={{
            level: t("diveSites.form.minimumCertificationLabel"),
            noLevel: t("diveSites.form.noLevelRequired"),
            nitrox: t("diveSites.form.nitroxCheckbox"),
          }}
          legend={requiredSpecialtiesLabel}
        />
      ),
    },
  };

  const order = siteFormSectionOrder(fieldGuideOn);
  const open = order.filter((section) => SITE_FORM_OPEN_SECTIONS.has(section));
  const closed = order.filter((section) => !SITE_FORM_OPEN_SECTIONS.has(section));
  return (
    <>
      {open.map((section, index) => {
        const parts = sections[section];
        return (
          <OpenEditorSection
            key={section}
            id={SITE_FORM_SECTION_IDS[section]}
            label={labels[section]}
            description={parts.description}
            grouped={parts.grouped}
            first={index === 0}
            unsavedTag={t("shared.formDraft.unsavedSection")}
          >
            {parts.body}
          </OpenEditorSection>
        );
      })}
      <DisclosureRowList>
        {closed.map((section) => {
          const parts = sections[section];
          return (
            <ClosedEditorSection
              key={section}
              id={SITE_FORM_SECTION_IDS[section]}
              label={labels[section]}
              description={parts.description}
              grouped={parts.grouped}
            >
              {parts.body}
            </ClosedEditorSection>
          );
        })}
        {spanish ? (
          <ClosedEditorSection
            id={SITE_FORM_SPANISH_ID}
            label={t("diveSites.form.sections.spanish")}
          >
            {spanish}
          </ClosedEditorSection>
        ) : null}
      </DisclosureRowList>
    </>
  );
}
