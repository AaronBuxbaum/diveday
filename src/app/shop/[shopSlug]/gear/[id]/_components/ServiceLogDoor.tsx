import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import {
  choiceClass,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
  textareaClassFor,
} from "@/components/ui/form";
import type { GearItemDetail } from "@/db/gear";
import { gearServiceKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { GEAR_SERVICE_KINDS_FOR } from "@/lib/gear";
import { recordGearServiceAction } from "../actions";

/**
 * **The service log's door**: on the Service card when the unit has clocks
 * or a paper trail, and on its own under the summary when it has neither.
 */
export function ServiceLogDoor({
  item,
  t,
  todayLocal,
  formOpen,
}: {
  item: GearItemDetail["item"];
  t: StaffTranslator;
  todayLocal: string;
  /** A save or a refusal from this form landed back here — bring it back standing. */
  formOpen: boolean;
}) {
  return (
    <details
      className="group open:basis-full print:[&:not([open])]:hidden"
      open={formOpen || undefined}
    >
      <summary
        className={buttonClass({
          variant: "link",
          size: "sm",
          flush: true,
          className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("gear.unit.service.logDoor")}
        <DisclosureCaret direction="down" className="group-open:rotate-180" />
      </summary>
      <FieldGrid as="form" action={recordGearServiceAction} columns={2} className="mt-4">
        <input type="hidden" name="gearItemId" value={item.id} />
        <Field label={t("gear.unit.service.kind")}>
          <select name="kind" className={controlClass}>
            {GEAR_SERVICE_KINDS_FOR[item.kind].map((option) => (
              <option key={option} value={option}>
                {gearServiceKindLabel(t, option)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("gear.unit.service.servicedOn")}>
          <DateField name="servicedOn" required defaultValue={todayLocal} />
        </Field>
        <Field
          label={t("gear.unit.service.nextDueOn")}
          hint={t("gear.form.optionalHint")}
          description={t("gear.unit.service.nextDueHint")}
        >
          <DateField name="nextDueOn" />
        </Field>
        <Field
          label={t("gear.unit.service.nextDueDives")}
          hint={t("gear.form.optionalHint")}
          description={t("gear.unit.service.nextDueDivesHint")}
        >
          <input
            type="number"
            name="nextDueDives"
            min={1}
            max={9999}
            inputMode="numeric"
            className={controlClass}
          />
        </Field>
        <Field label={t("gear.unit.service.note")} hint={t("gear.form.optionalHint")}>
          <textarea
            name="note"
            maxLength={500}
            rows={3}
            placeholder={t("gear.unit.service.notePlaceholder")}
            className={textareaClassFor(3)}
          />
        </Field>
        {item.status === "needs_service" ? (
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="returnToService" defaultChecked className={choiceClass} />
            {t("gear.unit.service.returnToService")}
          </label>
        ) : null}
        <FieldActions>
          <SubmitButton pendingLabel={t("gear.unit.service.logging")} className={buttonClass()}>
            {t("gear.unit.service.log")}
          </SubmitButton>
          <FormStatus />
        </FieldActions>
      </FieldGrid>
    </details>
  );
}
