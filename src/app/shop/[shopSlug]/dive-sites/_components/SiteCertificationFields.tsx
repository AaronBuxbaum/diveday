import { ChoiceFieldset, ChoiceRow, controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiveSpecialty } from "@/db/schema";
import { REQUIRABLE_CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SiteFieldValues } from "./SiteFields";

/** The specialty boxes' grid: two across on a phone, three from `sm`. */
const SPECIALTY_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3";

/**
 * The certification section: the least a site asks of a diver (recreational
 * rungs only), then each specialty and nitrox, under a caption on the edit
 * page and bare on the new one.
 */
export function SiteCertificationFields({
  t,
  values,
  requiredSpecialtiesLabel,
}: {
  t: StaffTranslator;
  values?: SiteFieldValues;
  requiredSpecialtiesLabel?: string;
}) {
  // What a site asks of a diver beyond a level: each specialty, then nitrox.
  const specialtyBoxes = (
    <>
      {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
        <ChoiceRow
          key={value}
          name="specialty"
          type="checkbox"
          value={value}
          defaultChecked={values?.requiredSpecialties.includes(value as DiveSpecialty) ?? false}
          className="text-sm font-medium"
        >
          {t(key)}
        </ChoiceRow>
      ))}
      <ChoiceRow
        name="requiresNitrox"
        type="checkbox"
        defaultChecked={values?.requiresNitrox ?? false}
        className="text-sm font-medium"
      >
        {t("diveSites.form.nitroxCheckbox")}
      </ChoiceRow>
    </>
  );

  return (
    <>
      <FieldGrid columns={1}>
        <Field label={t("diveSites.form.minimumCertificationLabel")}>
          <select
            name="minimumCertificationLevel"
            defaultValue={values?.minimumCertificationLevel ?? ""}
            className={controlClass}
          >
            <option value="">{t("diveSites.form.noLevelRequired")}</option>
            {/* Recreational rungs only — a site may not demand a working
                rating of a paying diver (issue #630). */}
            {REQUIRABLE_CERTIFICATION_LEVEL_KEYS.map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {/* Captioned, the boxes are one group under a legend at a field
          caption's distance (`ChoiceFieldset`); the new form passes no
          caption and they start at the section's own gap. A bare
          paragraph over a grid pushed `mt-3` down read as floating
          between the select above and its own boxes, and with no caption
          the `mt-3` stood them 32px under the select where the section's
          fields stand 20px apart (K-212). */}
      {requiredSpecialtiesLabel ? (
        <ChoiceFieldset legend={requiredSpecialtiesLabel} bodyClassName={SPECIALTY_GRID}>
          {specialtyBoxes}
        </ChoiceFieldset>
      ) : (
        <div className={SPECIALTY_GRID}>{specialtyBoxes}</div>
      )}
    </>
  );
}
