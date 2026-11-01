import { KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { GEAR_KIND_ORDER } from "@/lib/gear";
import { RENTAL_FIT_TEXT_LIMITS } from "@/lib/rentals";
import type { NoticeTone } from "@/lib/staff-notices";
import { createGearItemAction } from "../actions";

/**
 * The register's "Add a unit" form, inside its disclosure. A refusal names its
 * field beside it (`labelError`, `purchasedOnError`) or says so under the
 * button (`status`), and `refused` puts back what was typed.
 */
export function AddUnitForm({
  t,
  keptScope,
  refused,
  labelError,
  purchasedOnError,
  status,
  focusKey,
}: {
  t: StaffTranslator;
  /** `keptTypedScope`: this shop and this staffer. */
  keptScope: string;
  refused: boolean;
  labelError?: string;
  purchasedOnError?: string;
  /** The add form's own notice; `text` is null when a field already says it. */
  status?: { tone: NoticeTone; text: string | null };
  /** Changes with each notice so a repeated refusal re-fires the focus. */
  focusKey?: string;
}) {
  return (
    <div className="border-t border-border p-5 sm:p-6">
      <FieldGrid as="form" action={createGearItemAction} columns={2}>
        {/* A refused tag or date comes back with the serial, brand and
            size still typed. */}
        <KeepTypedOnRefusal form="gear-add-unit" scope={keptScope} restore={refused} />
        <Field label={t("gear.form.kind")}>
          <select name="kind" className={controlClass} defaultValue="bcd">
            {GEAR_KIND_ORDER.map((option) => (
              <option key={option} value={option}>
                {gearItemKindLabel(t, option)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("gear.form.label")} hint={t("gear.form.labelHint")} error={labelError}>
          <input
            name="label"
            required
            maxLength={80}
            placeholder={t("gear.form.labelPlaceholder")}
            className={controlClass}
          />
        </Field>
        {/* The action's own cap, which is the fit forms' cap
            (`RENTAL_FIT_TEXT_LIMITS.size`) because `keepRentalFitAction`
            copies this value into `rental_fit_profiles` — issue #1754. */}
        <Field label={t("gear.form.size")} hint={t("gear.form.optionalHint")}>
          <input
            name="size"
            maxLength={RENTAL_FIT_TEXT_LIMITS.size}
            placeholder={t("gear.form.sizePlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("gear.form.serialNumber")} hint={t("gear.form.optionalHint")}>
          <input name="serialNumber" maxLength={80} className={controlClass} />
        </Field>
        <Field label={t("gear.form.brandModel")} hint={t("gear.form.optionalHint")}>
          <input
            name="brandModel"
            maxLength={120}
            placeholder={t("gear.form.brandModelPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("gear.form.purchasedOn")}
          hint={t("gear.form.optionalHint")}
          error={purchasedOnError}
        >
          <DateField name="purchasedOn" />
        </Field>
        <FieldActions>
          <SubmitButton pendingLabel={t("gear.addUnit.pending")} className={buttonClass()}>
            {t("gear.addUnit.submit")}
          </SubmitButton>
          <FormStatus tone={status?.tone}>{status?.text ?? null}</FormStatus>
        </FieldActions>
      </FieldGrid>
      {/* Keyed on the notice so a repeated refusal re-fires the focus. */}
      <FieldErrorFocus key={focusKey} scope="add-unit" />
    </div>
  );
}
