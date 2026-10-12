import { ChoiceRow, controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DepthUnit } from "@/lib/depth-units";
import { stationDistanceInUnit, stationLabel, type TideStationEcho } from "@/lib/tide-stations";
import { TIDE_PREFERENCES } from "@/lib/tides";
import type { SiteFieldValues } from "./SiteFields";

/**
 * The forecast section's fields: the coordinates the forecast is read at, the
 * NOAA tide station (with what NOAA calls it, and the far-station prompt) and
 * the tide the site dives best on.
 */
export function SiteForecastFields({
  t,
  depthUnit,
  values,
  tideStation,
}: {
  t: StaffTranslator;
  depthUnit: DepthUnit;
  values?: SiteFieldValues;
  tideStation?: TideStationEcho | null;
}) {
  // Seven digits, and until issue #1468 nothing on this form said what they
  // named: a station typed for the wrong end of the Keys answered every
  // prediction request and read as an ordinary tide sentence on every
  // departure. The first line is NOAA's own answer to the id, so a wrong one
  // is legible as a wrong *place*; the second is advice about a station that
  // sits implausibly far from the coordinates two fields up, and it refuses
  // nothing — the save above it never waits on this lookup and a failed one
  // renders neither line.
  //
  // That second sentence names what the distance costs on the water, not the
  // distance alone: a divemaster acts on consequence, and eighty kilometres
  // down a chain moves the predicted turn by the better part of an hour —
  // which is the difference between a fact about a row and a fact about
  // whether the plan holds. The turn is already a height turn rather than
  // slack (ADR 20260907's 2026-09-07 amendment), so the hour is the second
  // error stacked on the first.
  //
  // **And it can be answered** (issue #1731). A genuinely remote site has no
  // nearer station to pick — Flower Garden Banks reads Galveston at about 190
  // km and is right — so without an answer that shop reads the prompt on every
  // visit forever, and a warning that is always wrong is one a crew learns to
  // click past. The cost lands on the next warning, which may be the Key Largo
  // reef reading Vaca Key. So the box below the fields is the answer, the
  // sentence stops once it is ticked, and the box stays on the page so the shop
  // can take the answer back. Still a prompt and never a refusal: the id saves
  // either way, and nothing here reaches a readiness or admission rule.
  const stationFar = Boolean(tideStation?.far && tideStation.distanceKm !== null);
  const stationConfirmed = values?.tideStationConfirmed ?? false;
  const tideStationNote = tideStation ? (
    <>
      <span className="block">
        {t("diveSites.form.tideStationEcho", {
          id: tideStation.id,
          name: stationLabel(tideStation),
        })}
      </span>
      {stationFar && !stationConfirmed && tideStation.distanceKm !== null ? (
        <span className="mt-0.5 block font-medium text-warning-strong">
          {depthUnit === "feet"
            ? t("diveSites.form.tideStationFarMiles", {
                distance: stationDistanceInUnit(tideStation.distanceKm, depthUnit),
              })
            : t("diveSites.form.tideStationFarKm", {
                distance: stationDistanceInUnit(tideStation.distanceKm, depthUnit),
              })}
        </span>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      <FieldGrid columns={2} className="gap-y-5">
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
        {/* The tide is read at a NOAA station, never at the coordinates
          above — a reef is rarely a station — so the id is its own field,
          and its help carries the one link a staffer needs to find one.
          A blank id says nothing about the tide anywhere (ADR
          20260907-noaa-tide-predictions).

          The help is the field's description, under the box, with the
          station NOAA answered for beneath it: two sentences and a link
          are not a `hint`, the inline "(optional)" on the caption's line,
          where they stood "NOAA tide station" two lines above "Dives
          best" beside it (K-418). */}
        <Field
          label={t("diveSites.form.tideStationLabel")}
          description={
            <>
              <span className="block">
                {t.rich("diveSites.form.tideStationHint", {
                  link: (chunks) => (
                    <a
                      href="https://tidesandcurrents.noaa.gov/tide_predictions.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </span>
              {tideStationNote}
            </>
          }
        >
          {/* No `pattern`: native constraint validation refuses the submit
            outright, in the browser's own words, and the form never
            reaches the refusal this repository already writes in both
            languages and puts on the field. */}
          <input
            name="tideStationId"
            inputMode="numeric"
            maxLength={7}
            defaultValue={values?.tideStationId ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.tidePreferenceLabel")}>
          <select
            name="tidePreference"
            defaultValue={values?.tidePreference ?? "any"}
            className={controlClass}
          >
            {TIDE_PREFERENCES.map((preference) => (
              <option key={preference} value={preference}>
                {t(`diveSites.form.tidePreference.${preference}`)}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {/* Only while there is something to answer. A station inside the
          threshold, a site with no coordinates to measure against and a
          lookup that answered nothing all leave the question unasked, and
          a tick box for a question nobody put is furniture. It follows the
          grid rather than sitting inside it because the grid's rows are a
          subgrid two tracks deep per field, and a checkbox belongs beside
          its own words the way the nitrox box does. No margin of its
          own: it is an item in the section's `gap-5` column, where a
          margin adds to the gap, and `mt-4` stood it 36px under the
          warning it answers, nearer the next section than its question
          (K-424). */}
      {stationFar ? (
        <ChoiceRow
          name="tideStationConfirmed"
          type="checkbox"
          defaultChecked={stationConfirmed}
          className="text-sm font-medium"
        >
          {t("diveSites.form.tideStationConfirmedCheckbox")}
        </ChoiceRow>
      ) : null}
    </>
  );
}
