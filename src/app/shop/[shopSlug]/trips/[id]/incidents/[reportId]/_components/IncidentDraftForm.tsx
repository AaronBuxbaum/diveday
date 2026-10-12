import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FormStatus,
  textareaClassFor,
} from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  INCIDENT_HANDOVER_KINDS,
  INCIDENT_OXYGEN_MINUTES_MAX,
  INCIDENT_SHORT_TEXT_MAX,
  INCIDENT_TEXT_MAX,
  type IncidentDraftFields,
} from "@/lib/incident-reports";
import type { FormNotice } from "@/lib/staff-notices";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import { HANDOVER_KIND_KEYS } from "./incident-words";

/** A yes/no pair that starts unanswered: a blank is never read as "no". */
function YesNo({
  name,
  legend,
  value,
  t,
}: {
  name: string;
  legend: string;
  value: boolean | null;
  t: StaffTranslator;
}) {
  return (
    <ChoiceFieldset legend={legend} bodyClassName="flex flex-wrap gap-x-6">
      <ChoiceRow type="radio" name={name} value="yes" defaultChecked={value === true}>
        {t("incidents.form.yes")}
      </ChoiceRow>
      <ChoiceRow type="radio" name={name} value="no" defaultChecked={value === false}>
        {t("incidents.form.no")}
      </ChoiceRow>
    </ChoiceFieldset>
  );
}

/**
 * The draft's fields. Every answer is optional while it is a draft; filing
 * asks for the ones a report cannot go without (`incidentFilingGaps`).
 */
export function IncidentDraftForm({
  fields,
  diveSites,
  timeZone,
  zoneName,
  action,
  notice,
  t,
}: {
  fields: IncidentDraftFields;
  diveSites: readonly { id: string; name: string }[];
  timeZone: string;
  zoneName: string;
  action: (formData: FormData) => Promise<void>;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  const occurred = fields.occurredAt ? utcToWallTime(fields.occurredAt, timeZone) : null;
  const handedOver = fields.handedOverAt ? utcToWallTime(fields.handedOverAt, timeZone) : null;
  return (
    <form action={action} className="space-y-10">
      <SectionCard
        title={t("incidents.form.whenWhere")}
        description={t("incidents.page.timesIn", { zone: zoneName })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("incidents.form.occurredOn")}>
            <DateField
              name="occurredOn"
              defaultValue={occurred ? toDateInputValue(occurred) : ""}
            />
          </Field>
          <Field label={t("incidents.form.occurredTime")}>
            <DateField
              name="occurredTime"
              type="time"
              defaultValue={occurred ? toTimeInputValue(occurred) : ""}
            />
          </Field>
          <Field label={t("incidents.form.diveSite")}>
            <select
              name="diveSiteId"
              defaultValue={fields.diveSiteId ?? ""}
              className={controlClass}
            >
              <option value="">{t("incidents.form.diveSiteNone")}</option>
              {diveSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("incidents.form.locationText")}
            hint={t("incidents.form.optional")}
            description={t("incidents.form.locationHint")}
          >
            <input
              name="locationText"
              defaultValue={fields.locationText ?? ""}
              maxLength={INCIDENT_SHORT_TEXT_MAX}
              className={controlClass}
            />
          </Field>
        </div>
        <Field
          className="mt-4"
          label={t("incidents.form.whatHappened")}
          description={t("incidents.form.whatHappenedHint")}
        >
          <textarea
            name="whatHappened"
            defaultValue={fields.whatHappened ?? ""}
            maxLength={INCIDENT_TEXT_MAX}
            className={textareaClassFor(6)}
          />
        </Field>
      </SectionCard>

      <SectionCard title={t("incidents.form.care")}>
        <div className="space-y-4">
          <YesNo
            name="firstAidGiven"
            legend={t("incidents.form.firstAid")}
            value={fields.firstAidGiven}
            t={t}
          />
          <YesNo
            name="oxygenGiven"
            legend={t("incidents.form.oxygen")}
            value={fields.oxygenGiven}
            t={t}
          />
          <Field
            className="sm:max-w-60"
            label={t("incidents.form.oxygenMinutes")}
            hint={t("incidents.form.optional")}
            description={t("incidents.form.oxygenMinutesHint")}
          >
            <input
              name="oxygenMinutes"
              inputMode="numeric"
              pattern="[0-9]*"
              max={INCIDENT_OXYGEN_MINUTES_MAX}
              defaultValue={fields.oxygenMinutes ?? ""}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <YesNo
            name="emergencyServicesCalled"
            legend={t("incidents.form.emergencyServices")}
            value={fields.emergencyServicesCalled}
            t={t}
          />
        </div>
      </SectionCard>

      <SectionCard title={t("incidents.form.handover")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("incidents.form.handoverKind")}>
            <select
              name="handoverKind"
              defaultValue={fields.handoverKind ?? ""}
              className={controlClass}
            >
              <option value="">{t("incidents.form.handoverNone")}</option>
              {INCIDENT_HANDOVER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(HANDOVER_KIND_KEYS[kind])}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("incidents.form.handoverDetail")}
            hint={t("incidents.form.optional")}
            description={t("incidents.form.handoverDetailHint")}
          >
            <input
              name="handoverDetail"
              defaultValue={fields.handoverDetail ?? ""}
              maxLength={INCIDENT_SHORT_TEXT_MAX}
              className={controlClass}
            />
          </Field>
          <Field label={t("incidents.form.handedOverOn")} hint={t("incidents.form.optional")}>
            <DateField
              name="handedOverOn"
              defaultValue={handedOver ? toDateInputValue(handedOver) : ""}
            />
          </Field>
          <Field label={t("incidents.form.handedOverTime")} hint={t("incidents.form.optional")}>
            <DateField
              name="handedOverTime"
              type="time"
              defaultValue={handedOver ? toTimeInputValue(handedOver) : ""}
            />
          </Field>
        </div>
        <Field
          className="mt-4"
          label={t("incidents.form.followUp")}
          hint={t("incidents.form.optional")}
          description={t("incidents.form.followUpHint")}
        >
          <textarea
            name="followUp"
            defaultValue={fields.followUp ?? ""}
            maxLength={INCIDENT_TEXT_MAX}
            className={textareaClassFor(3)}
          />
        </Field>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel={t("incidents.form.saving")} className={buttonClass()}>
            {t("incidents.form.save")}
          </SubmitButton>
          <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
        </div>
      </SectionCard>
    </form>
  );
}
