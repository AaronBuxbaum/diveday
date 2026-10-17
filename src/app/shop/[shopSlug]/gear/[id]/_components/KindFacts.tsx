import { ChoiceRow, controlClass, Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type GearItemKind, WETSUIT_THICKNESS_MM } from "@/lib/gear";
import { AboardBoatField, type GearUnitHull } from "./AboardBoatField";

// The page reads the hull helpers through this module, beside the fields they feed.
export { aboardText, gearUnitHull } from "./AboardBoatField";

/**
 * **The facts only some kinds of unit carry**, on the unit's details form:
 * where a piece of safety kit lives aboard (`AboardBoatField`), then the one
 * fact of the unit's own kind.
 *
 * A regulator says whether the shop keeps it for enriched air (issue #2207).
 * The box is posted beside a hidden `off`, so an unticked box saves "no"
 * while a form that never drew it (any other kind) leaves the answer alone;
 * `updateGearItem` clears it anyway once the unit is not a regulator.
 *
 * A wetsuit says its thickness in whole millimetres (issue #2206), which is
 * what the Gear tab matches against the day's wetsuit. Blank is "not said".
 */
export function KindFacts({
  hull,
  item,
  t,
}: {
  hull: GearUnitHull;
  item: UnitFacts;
  t: StaffTranslator;
}) {
  return (
    <>
      <AboardBoatField hull={hull} t={t} />
      <OwnKindFact item={item} t={t} />
    </>
  );
}

type UnitFacts = {
  kind: GearItemKind;
  nitroxDesignated: boolean | null;
  thicknessMm: number | null;
};

function OwnKindFact({ item, t }: { item: UnitFacts; t: StaffTranslator }) {
  if (item.kind === "wetsuit") {
    return (
      <Field label={t("gear.form.thicknessMm")} hint={t("gear.form.optionalHint")}>
        <input
          name="thicknessMm"
          type="number"
          inputMode="numeric"
          step={1}
          min={WETSUIT_THICKNESS_MM.min}
          max={WETSUIT_THICKNESS_MM.max}
          defaultValue={item.thicknessMm ?? ""}
          className={`${controlClass} tabular-nums`}
        />
      </Field>
    );
  }
  if (item.kind !== "regulator") return null;
  return (
    <Field label={t("gear.form.nitroxDesignated")} htmlFor="gear-unit-nitrox-designated">
      <input type="hidden" name="nitroxDesignated" value="off" />
      <ChoiceRow
        type="checkbox"
        id="gear-unit-nitrox-designated"
        name="nitroxDesignated"
        value="on"
        defaultChecked={item.nitroxDesignated === true}
        className="text-sm"
      >
        {t("gear.form.nitroxDesignatedHint")}
      </ChoiceRow>
    </Field>
  );
}
