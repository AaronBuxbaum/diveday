import { ChoiceRow, Field } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { GearItemKind } from "@/lib/gear";

/**
 * **The facts only one kind of unit carries**, on the unit's details form.
 *
 * A regulator says whether the shop keeps it for enriched air (issue #2207).
 * The box is posted beside a hidden `off`, so an unticked box saves "no"
 * while a form that never drew it (any other kind) leaves the answer alone;
 * `updateGearItem` clears it anyway once the unit is not a regulator.
 */
export function KindFacts({
  item,
  t,
}: {
  item: { kind: GearItemKind; nitroxDesignated: boolean | null };
  t: StaffTranslator;
}) {
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
