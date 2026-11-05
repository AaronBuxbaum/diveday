import type { ReactNode } from "react";
import { ChoiceFieldset, ChoiceRow, controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiveSpecialty } from "@/db/schema";
import { REQUIRABLE_CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Requirement } from "@/lib/requirement";

/** The specialty boxes' grid: two across on a phone, three from `sm`. */
const SPECIALTY_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3";

/**
 * The one form for a requirement (`Requirement`, src/lib/requirement.ts): the
 * least certification level, each specialty and nitrox. A dive site and a
 * departure both ask exactly this of a diver, so both render it here and both
 * submit the names `readRequirementForm` reads (`minimumCertificationLevel`,
 * repeated `specialty`, `requiresNitrox`).
 *
 * Only the level rungs a shop may demand appear (recreational, issue #630).
 * `legend` captions the specialty boxes as one group; without it they start at
 * the section's own gap. `leading` stands in the level select's grid, ahead of
 * it (the departure form's waiver and payment boxes).
 */
export function RequirementFields({
  t,
  requirement,
  defaultLevel,
  labels,
  legend,
  legendClassName,
  leading,
  locked,
}: {
  t: StaffTranslator;
  requirement?: Requirement | null;
  /** The level preselected when there is no stored requirement. */
  defaultLevel: string;
  labels: { level: string; noLevel: string; nitrox: string };
  legend?: string;
  legendClassName?: string;
  leading?: ReactNode;
  /**
   * Set, as the sentence saying why, when the reader may not change these
   * (a dive site's admission fields, issue #3706). The controls show the
   * stored values disabled, and hidden inputs post exactly those values back,
   * so the save sees them unchanged.
   */
  locked?: string;
}) {
  const disabled = locked !== undefined;
  const level = requirement?.minimumCertificationLevel ?? defaultLevel;
  const levelField = (
    <FieldGrid columns={1}>
      <Field label={labels.level} description={locked}>
        {disabled ? <input type="hidden" name="minimumCertificationLevel" value={level} /> : null}
        <select
          name={disabled ? undefined : "minimumCertificationLevel"}
          defaultValue={level}
          disabled={disabled}
          className={controlClass}
        >
          <option value="">{labels.noLevel}</option>
          {REQUIRABLE_CERTIFICATION_LEVEL_KEYS.map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
      </Field>
    </FieldGrid>
  );
  const boxes = (
    <>
      {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
        <ChoiceRow
          key={value}
          name={disabled ? undefined : "specialty"}
          type="checkbox"
          value={value}
          defaultChecked={
            requirement?.requiredSpecialties.includes(value as DiveSpecialty) ?? false
          }
          disabled={disabled}
          className="text-sm font-medium"
        >
          {t(key)}
        </ChoiceRow>
      ))}
      {disabled
        ? (requirement?.requiredSpecialties ?? []).map((specialty) => (
            <input key={specialty} type="hidden" name="specialty" value={specialty} />
          ))
        : null}
      {disabled && requirement?.requiresNitrox ? (
        <input type="hidden" name="requiresNitrox" value="on" />
      ) : null}
      <ChoiceRow
        name={disabled ? undefined : "requiresNitrox"}
        type="checkbox"
        defaultChecked={requirement?.requiresNitrox ?? false}
        disabled={disabled}
        className="text-sm font-medium"
      >
        {labels.nitrox}
      </ChoiceRow>
    </>
  );

  return (
    <>
      {leading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end">
          {leading}
          {levelField}
        </div>
      ) : (
        levelField
      )}
      {legend ? (
        <ChoiceFieldset legend={legend} className={legendClassName} bodyClassName={SPECIALTY_GRID}>
          {boxes}
        </ChoiceFieldset>
      ) : (
        <div className={SPECIALTY_GRID}>{boxes}</div>
      )}
    </>
  );
}
