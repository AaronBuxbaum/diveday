import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import { DIVE_SITE_DIFFICULTIES } from "@/lib/dive-site-difficulty";
import { DOCK_DAY_LIMITS } from "@/lib/diver-planning";
import type { SiteFieldValues } from "./SiteFields";

/**
 * The dive section: difficulty, snorkeling, depth, bottom time, current and the plan — the
 * facts a briefing states and a planner reads, depth entered in the shop's
 * own unit and stored in metres.
 */
export function SiteDiveFields({
  t,
  depthUnit,
  values,
}: {
  t: StaffTranslator;
  depthUnit: DepthUnit;
  values?: SiteFieldValues;
}) {
  const unitKey = depthUnit === "feet" ? "Feet" : "Meters";
  // The folded section's preview reads these off the two depth inputs, in
  // page order (shallow, then deep): see `sectionPreview`.
  const depthPreview = {
    "data-preview-pair": "depth",
    "data-preview-one": t.raw(`diveSites.form.depthPreview${unitKey}One`),
    "data-preview-range": t.raw(`diveSites.form.depthPreview${unitKey}Range`),
  };
  return (
    <>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("diveSites.form.difficultyLabel")} hint={t("diveSites.form.optionalHint")}>
          {/* A picker, not a text box: the word ends up on a diver's
              briefing and has to arrive in their language, so it is a code
              with a translated label (ADR
              20260813-marine-life-is-diveday-copy applies the same
              reasoning to species). Every value any shop had typed here was
              already one of these three. */}
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
        {/* Beside difficulty because it is the same kind of fact about the
            place, for the people who stay at the surface (issue #2214). Not
            said is its own answer: it never reads as no. */}
        <Field label={t("diveSites.form.snorkelLabel")} hint={t("diveSites.form.optionalHint")}>
          <select
            name="snorkelSuitable"
            defaultValue={
              values?.snorkelSuitable === true
                ? "yes"
                : values?.snorkelSuitable === false
                  ? "no"
                  : ""
            }
            className={controlClass}
          >
            <option value="">{t("diveSites.form.snorkelUnset")}</option>
            <option value="yes">{t("diveSites.form.snorkelYes")}</option>
            <option value="no">{t("diveSites.form.snorkelNo")}</option>
          </select>
        </Field>
        {/* Minutes, in nobody's unit but its own — so it sits with the site's
            other facts rather than being folded into the shop-wide rhythm in
            Settings. A wall run at 30 minutes and a shallow reef run at 60
            are both real, and one shop-wide number told a diver the wrong
            one on whichever it was not. Blank leaves the shop's own figure
            standing. */}
        <Field
          label={t("diveSites.form.expectedBottomTimeLabel")}
          hint={t("diveSites.form.optionalHint")}
          description={t("diveSites.form.expectedBottomTimeHint")}
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
      <FieldGrid columns={2} className="gap-y-5">
        {/* The shallow end of the range, beside the deep end below. Both are
            typed in the shop's unit and stored in metres, so a briefing prints
            one unit whatever this shop typed or later switches to. */}
        <Field
          label={t(
            depthUnit === "feet"
              ? "diveSites.form.minDepthFeetLabel"
              : "diveSites.form.minDepthMetersLabel",
          )}
          hint={t("diveSites.form.optionalHint")}
        >
          <input
            name="minDepth"
            {...depthPreview}
            type="number"
            inputMode="numeric"
            min={0}
            max={maxEnteredDepth(depthUnit)}
            step={1}
            defaultValue={
              values?.depthMinMeters == null ? "" : depthInUnit(values.depthMinMeters, depthUnit)
            }
            placeholder={depthUnit === "feet" ? "20" : "6"}
            className={controlClass}
          />
        </Field>
        {/* The one depth figure a certification ceiling can be compared
            against (H-20260724-certification-levels-agency-rules). Left blank it simply never warns — this advises,
            it never gates. */}
        <Field
          label={t(
            depthUnit === "feet"
              ? "diveSites.form.maxDepthFeetLabel"
              : "diveSites.form.maxDepthMetersLabel",
          )}
          hint={t("diveSites.form.optionalHint")}
          description={t("diveSites.form.maxDepthHint")}
        >
          <input
            name="maxDepth"
            {...depthPreview}
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
        {/* The shop's own words about depth, for what two numbers cannot say.
            The briefing prints the numbers; this stands in only where they
            are blank. */}
        <Field
          label={t("diveSites.form.depthNoteLabel")}
          hint={t("diveSites.form.optionalHint")}
          description={t("diveSites.form.depthNoteHint")}
        >
          <input
            name="depthRange"
            maxLength={120}
            defaultValue={values?.depthRange ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("diveSites.form.currentNoteLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="currentNote"
            rows={2}
            maxLength={500}
            defaultValue={values?.currentNote ?? ""}
            className={textareaClassFor(2)}
          />
        </Field>
        <Field label={t("diveSites.form.divePlanLabel")} hint={t("diveSites.form.optionalHint")}>
          <textarea
            name="divePlan"
            rows={3}
            maxLength={1200}
            defaultValue={values?.divePlan ?? ""}
            placeholder={t("diveSites.form.divePlanPlaceholder")}
            className={textareaClassFor(3)}
          />
        </Field>
        {/* A sentence of help, so a description under the box, as the
            form's other help is; not the caption's inline hint (K-418). */}
        <Field
          label={t("diveSites.form.conservationNoteLabel")}
          description={t("diveSites.form.conservationNoteHint")}
        >
          <textarea
            name="conservationNote"
            rows={3}
            maxLength={600}
            defaultValue={values?.conservationNote ?? ""}
            placeholder={t("diveSites.form.conservationNotePlaceholder")}
            className={textareaClassFor(3)}
          />
        </Field>
      </FieldGrid>
    </>
  );
}
